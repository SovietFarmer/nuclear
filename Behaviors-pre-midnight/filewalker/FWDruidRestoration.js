import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr from "@/Core/ObjectManager";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { ShapeshiftForm } from "@/Enums/UnitEnums";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import Settings from "@/Core/Settings";

const EFFLORESCENCE_RADIUS = 11;

// Aura IDs for tracking
const auras = {
  rejuvenation: 774,
  wildGrowth: 48438,
  regrowth: 8936,
  lifebloom: 33763,
  clearcasting: 16870,
  abundance: 207383,
  springBlossoms: 207386,
  cultivation: 200389,
  cenarionWard: 102352,
  ironbark: 102342,
  barkskin: 22812,
  incarnationTree: 33891,
  efflorescence: 145205,
  soulOfTheForest: 114108,
  photosynthesis: 274902,
  adaptiveSwarm: 325748,
  flourish: 197721,
  overgrowth: 203651,
  groveGuardian: 400021, // Grove Guardian spell aura ID
  groveGuardianPet: 400022 // Guardian Pet active aura ID
};

export class DruidRestorationBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Restoration;
  version = wow.GameVersion.Retail;
  name = "FW Resto Druid"

  // Variables for tracking rotation state
  _variables = {};
  lastTravelFormAttempt = 0;

  // Settings configuration for UI
  static settings = [
    {
      header: "Build Selection",
      options: [
        {
          type: "dropdown",
          uid: "DruidRestoBuildType",
          text: "Build Type",
          values: ["Raid Healing", "Mythic+ Healing", "Tank Healing", "PvP Healing"],
          default: "Raid Healing"
        }
      ]
    },
    {
      header: "Single Target Healing",
      options: [
        {
          type: "slider",
          uid: "DruidRestoRejuvenationPercent",
          text: "Rejuvenation Threshold",
          min: 0,
          max: 100,
          default: 90
        },
        {
          type: "slider",
          uid: "DruidRestoRegrowthPercent",
          text: "Regrowth Threshold",
          min: 0,
          max: 100,
          default: 75
        },
        {
          type: "slider",
          uid: "DruidRestoSwiftmendPercent",
          text: "Swiftmend Threshold",
          min: 0,
          max: 100,
          default: 65
        },
        {
          type: "slider",
          uid: "DruidRestoPanicThreshold",
          text: "Emergency Healing Threshold",
          min: 0,
          max: 100,
          default: 30
        }
      ]
    },
    {
      header: "AoE Healing",
      options: [
        {
          type: "slider",
          uid: "DruidRestoWildGrowthMinTargets",
          text: "Wild Growth Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "DruidRestoWildGrowthPercent",
          text: "Wild Growth Health Threshold",
          min: 0,
          max: 100,
          default: 85
        },
        {
          type: "slider",
          uid: "DruidRestoEfflorescenceMinTargets",
          text: "Efflorescence Minimum Targets",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "DruidRestoEfflorescencePercent",
          text: "Efflorescence Health Threshold",
          min: 0,
          max: 100,
          default: 90
        },
        {
          type: "slider",
          uid: "DruidRestoTransquilityMinTargets",
          text: "Tranquility Minimum Targets",
          min: 1,
          max: 10,
          default: 5
        },
        {
          type: "slider",
          uid: "DruidRestoTransquilityPercent",
          text: "Tranquility Health Threshold",
          min: 0,
          max: 100,
          default: 60
        }
      ]
    },
    {
      header: "HoT Management",
      options: [
        {
          type: "slider",
          uid: "DruidRestoMaxRejuvenationTargets",
          text: "Maximum Rejuvenation Targets",
          min: 1,
          max: 20,
          default: 8
        },
        {
          type: "checkbox", 
          uid: "DruidRestoScaleRejuvWithRaidSize",
          text: "Scale Max Rejuvenation with Raid Size",
          default: true
        },
        {
          type: "checkbox",
          uid: "DruidRestoIncreasedRejuvWithAbundance",
          text: "Increase Max Rejuvenation with Abundance",
          default: true
        }
      ]
    },
    {
      header: "Tank Healing",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoPrioritizeTanks",
          text: "Prioritize Keeping HoTs on Tanks",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoIronbarkThreshold",
          text: "Ironbark Health Threshold",
          min: 0,
          max: 100,
          default: 40
        },
        {
          type: "slider",
          uid: "DruidRestoCenarionWardThreshold",
          text: "Cenarion Ward Health Threshold",
          min: 0,
          max: 100,
          default: 90
        }
      ]
    },
    {
      header: "Cooldown Management",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoUseFlourish",
          text: "Use Flourish",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoFlourishMinHoTs",
          text: "Flourish Minimum HoTs Active",
          min: 1,
          max: 15,
          default: 6
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseTreeOfLife",
          text: "Use Incarnation: Tree of Life",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoTreeOfLifeMinTargets",
          text: "Tree of Life Minimum Injured Targets",
          min: 1,
          max: 10,
          default: 4
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseConvoke",
          text: "Use Convoke the Spirits",
          default: true
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseAdaptiveSwarm",
          text: "Use Adaptive Swarm",
          default: true
        }
      ]
    },
    {
      header: "Grove Guardian Settings",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoUseGroveGuardian",
          text: "Use Grove Guardian",
          default: true
        },
        {
          type: "dropdown",
          uid: "DruidRestoGroveGuardianMode",
          text: "Grove Guardian Mode",
          values: ["Auto", "Healing Priority", "DPS Priority"],
          default: "Auto"
        }
      ]
    },
    {
      header: "Defensive Cooldowns",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoUseBarkskin",
          text: "Use Barkskin",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoBarkskinThreshold",
          text: "Barkskin Health Threshold",
          min: 0,
          max: 100,
          default: 60
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseRenewal",
          text: "Use Renewal",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoRenewalThreshold",
          text: "Renewal Health Threshold",
          min: 0,
          max: 100,
          default: 50
        }
      ]
    },
    {
      header: "Dispel Settings",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoUseNaturesCure",
          text: "Use Nature's Cure",
          default: true
        },
        {
          type: "dropdown",
          uid: "DruidRestoDispelPriority",
          text: "Dispel Priority",
          values: ["Low", "Medium", "High"],
          default: "Medium"
        }
      ]
    },
    {
      header: "Movement and Forms",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoUseTravelForm",
          text: "Use Travel Form",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoTravelFormCooldown",
          text: "Travel Form Check Cooldown (seconds)",
          min: 1,
          max: 10,
          default: 3
        },
        {
          type: "slider",
          uid: "DruidRestoTravelFormMinDistance",
          text: "Minimum Distance for Travel Form",
          min: 10,
          max: 100,
          default: 30
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseCatFormOOC",
          text: "Use Cat Form Out of Combat",
          default: false
        }
      ]
    },
    {
      header: "DPS Settings",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoEnableDPS",
          text: "Enable DPS During Downtime",
          default: true
        },
        {
          type: "checkbox",
          uid: "DruidRestoUseSunfire",
          text: "Use Sunfire",
          default: true
        },
        {
          type: "slider",
          uid: "DruidRestoSunfireRefreshThreshold",
          text: "Sunfire Refresh Threshold (seconds)",
          min: 1,
          max: 10,
          default: 4
        },
        {
          type: "slider",
          uid: "DruidRestoMoonfireRefreshThreshold",
          text: "Moonfire Refresh Threshold (seconds)",
          min: 1,
          max: 10,
          default: 4
        }
      ]
    },
    {
      header: "Talent Detection",
      options: [
        {
          type: "checkbox",
          uid: "DruidRestoManualTalentConfig",
          text: "Manually Configure Talents",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentPhotosynthesis",
          text: "Photosynthesis",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentCenarionWard",
          text: "Cenarion Ward",
          default: true
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentCultivation",
          text: "Cultivation",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentGroveGuardian",
          text: "Grove Guardian",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentFlourish",
          text: "Flourish",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentTreeOfLife",
          text: "Incarnation: Tree of Life",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentAdaptiveSwarm",
          text: "Adaptive Swarm",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentConvoke",
          text: "Convoke the Spirits",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentSoulOfTheForest",
          text: "Soul of the Forest",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentSpringBlossoms",
          text: "Spring Blossoms",
          default: true
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentAbundance",
          text: "Abundance",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentOvergrowth",
          text: "Overgrowth",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentGroveGuardians",
          text: "Grove Guardians",
          default: false
        },
        {
          type: "checkbox",
          uid: "DruidRestoTalentRenewal",
          text: "Renewal",
          default: false
        }
      ]
    }
  ];
  build() {
    // Initialize talent detection and variables
    this.initializeVariables();
    this.initializeTalents();
    // Get the selected build type
    const buildType = Settings.DruidRestoBuildType || "Raid Healing";
    
    return new bt.Selector(
      // These checks should happen regardless of GCD state
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      
      // Add Grove Guardian handling outside of GCD check
      // This ensures it can be summoned regardless of GCD state
      
     
      // Now add the GCD check for all other abilities
      new bt.Decorator(
        
        ret => !spell.isGlobalCooldown(),
        //this.handleGroveGuardian(),
        new bt.Selector(
          // this.handleFormManagement(),
          this.handleDefensiveCooldowns(),
          this.handleEmergencyHealing(),
          this.handleDispels(),
          this.handleBuffs(),
          
          // Major cooldowns that aren't Grove Guardian
          this.handleMajorCooldowns(),
          
          // Adapt rotation based on build type
          buildType === "Raid Healing" ? this.raidHealingRotation() :
          buildType === "Mythic+ Healing" ? this.mythicPlusRotation() :
          buildType === "Tank Healing" ? this.tankHealingRotation() :
          buildType === "PvP Healing" ? this.pvpHealingRotation() :
          this.generalHealingRotation(),
          
          // Fallback to DPS if no healing needed
          this.handleDamageDealing()
        )
      )
    );
  }
  
  /******************************************
   * Talent and Variable Management
   ******************************************/
  
  initializeTalents() {
    this.talents = {
      hasAbundance: false,
      hasPhotosynthesis: false,
      hasCenarionWard: false,
      hasFlourish: false,
      hasEfflorescence: false,
      hasRenewal: false,
      hasAdaptiveSwarm: false,
      hasConvoke: false,
      hasSoulOfTheForest: false,
      hasTreeOfLife: false,
      hasSpringBlossoms: false,
      hasOvergrowth: false,
      hasCultivation: false,
      hasGroveGuardian: false
    };
    
    // If manual configuration is enabled, use settings values
    if (Settings.DruidRestoManualTalentConfig) {
      this.talents.hasAbundance = Settings.DruidRestoTalentAbundance;
      this.talents.hasPhotosynthesis = Settings.DruidRestoTalentPhotosynthesis;
      this.talents.hasCenarionWard = Settings.DruidRestoTalentCenarionWard;
      this.talents.hasFlourish = Settings.DruidRestoTalentFlourish;
      this.talents.hasRenewal = Settings.DruidRestoTalentRenewal;
      this.talents.hasAdaptiveSwarm = Settings.DruidRestoTalentAdaptiveSwarm;
      this.talents.hasConvoke = Settings.DruidRestoTalentConvoke;
      this.talents.hasSoulOfTheForest = Settings.DruidRestoTalentSoulOfTheForest;
      this.talents.hasTreeOfLife = Settings.DruidRestoTalentTreeOfLife;
      this.talents.hasSpringBlossoms = Settings.DruidRestoTalentSpringBlossoms;
      this.talents.hasOvergrowth = Settings.DruidRestoTalentOvergrowth;
      this.talents.hasGroveGuardian = Settings.DruidRestoTalentGroveGuardians; // Fixed typo here
      this.talents.hasCultivation = Settings.DruidRestoTalentCultivation;
    } else {
      // Otherwise detect from player auras
      this.talents.hasAbundance = me.hasAura("Abundance");
      this.talents.hasPhotosynthesis = me.hasAura("Photosynthesis");
      this.talents.hasCenarionWard = me.hasAura("Cenarion Ward");
      this.talents.hasFlourish = me.hasAura("Flourish");
      this.talents.hasEfflorescence = true;
      this.talents.hasRenewal = me.hasAura("Renewal");
      this.talents.hasAdaptiveSwarm = me.hasAura("Adaptive Swarm");
      this.talents.hasConvoke = me.hasAura("Convoke the Spirits");
      this.talents.hasSoulOfTheForest = me.hasAura("Soul of the Forest");
      this.talents.hasTreeOfLife = me.hasAura("Incarnation: Tree of Life");
      this.talents.hasSpringBlossoms = me.hasAura("Spring Blossoms");
      this.talents.hasOvergrowth = me.hasAura("Overgrowth");
      this.talents.hasGroveGuardian = me.hasAura("Grove Guardians");
      this.talents.hasCultivation = me.hasAura("Cultivation");
    }
  }
  
  initializeVariables() {
    // Create the variables storage if it doesn't exist
    this._variables = {};
    
    // Set initial values
    this.lastTravelFormAttempt = 0;
    this.shouldSummon = false;
    this.setVariable("efflorescencePlacementChecked", false);
  }
  
  hasVariable(variableName) {
    if (!this._variables) {
      this._variables = {};
    }
    
    const key = variableName.toString();
    return this._variables[key] === true;
  }
  
  setVariable(variableName, value = true) {
    if (!this._variables) {
      this._variables = {};
    }
    
    const key = variableName.toString();
    this._variables[key] = value === true;
  }
  
  clearVariable(variableName) {
    if (!this._variables) {
      this._variables = {};
    }
    
    const key = variableName.toString();
    delete this._variables[key];
  }
  /******************************************
   * Form Management
   ******************************************/
  
  handleFormManagement() {
    return new bt.Selector(
      // Get out of non-humanoid forms when in combat and need to heal
      new bt.Decorator(
        req => me.inCombat && me.shapeshiftForm !== 0 && this.needHealing(),
        spell.cast("Cancel Shapeshift")
      ),
      
      // Stay in humanoid form during combat
      new bt.Action(() => {
        if (me.inCombat && me.shapeshiftForm === 0) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      
      // Use Travel Form with extensive checks to prevent spamming
      new bt.Decorator(
        req => {
          const currentTime = Date.now() / 1000;
          
          return Settings.DruidRestoUseTravelForm && 
                 !me.inCombat && 
                 me.isMoving && 
                 me.shapeshiftForm !== ShapeshiftForm.Travel && 
                 !me.isMounted &&
                 !me.isIndoors &&
                 (currentTime - this.lastTravelFormAttempt > Settings.DruidRestoTravelFormCooldown) &&
                 (!me.hasTarget || me.distanceTo(me.target) > Settings.DruidRestoTravelFormMinDistance);
        },
        new bt.Sequence(
          new bt.Action(() => {
            // Update the last attempt time
            this.lastTravelFormAttempt = Date.now() / 1000;
            return bt.Status.Success;
          }),
          spell.cast("Travel Form")
        )
      ),
      
      // Use Cat Form when desired out of combat
      new bt.Decorator(
        req => !me.inCombat && 
               Settings.DruidRestoUseCatFormOOC && 
               me.shapeshiftForm !== ShapeshiftForm.Cat && 
               !me.isMounted && 
               !this.needHealing() &&
               !me.isMoving,
        spell.cast("Cat Form")
      ),
    );

    
  }
  
  needHealing() {
    return heal.getPriorityTarget()?.predictedHealthPercent < 95;
  }
  
  /******************************************
   * Defensive Cooldowns
   ******************************************/
  
  handleDefensiveCooldowns() {
    return new bt.Selector(
      // Use Barkskin when taking heavy damage
      new bt.Decorator(
        req => Settings.DruidRestoUseBarkskin && 
               me.inCombat && 
               me.pctHealth < Settings.DruidRestoBarkskinThreshold,
        spell.cast("Barkskin", on => me)
      ),
      
      // Use Renewal if talented
      new bt.Decorator(
        req => this.talents.hasRenewal && 
               Settings.DruidRestoUseRenewal && 
               me.inCombat && 
               me.pctHealth < Settings.DruidRestoRenewalThreshold,
        spell.cast("Renewal", on => me)
      )
    );
  }
  
  /******************************************
   * Emergency Healing
   ******************************************/
  
  handleEmergencyHealing() {
    return new bt.Decorator(
      req => heal.getPriorityTarget()?.predictedHealthPercent < Settings.DruidRestoPanicThreshold,
      new bt.Sequence(
        // Use Nature's Swiftness for instant cast
        spell.cast("Nature's Swiftness", on => me),
        
        // Apply Ironbark on the critical target
        spell.cast("Ironbark", on => heal.getPriorityTarget()),
        
        // Use critical healing
        spell.cast("Regrowth", on => heal.getPriorityTarget()),
        
        // Use Swiftmend if available
        spell.cast("Swiftmend", req => this.findSwiftmendTarget(true)),
        
        // Use adaptive swarm if talented
        new bt.Decorator(
          req => this.talents.hasAdaptiveSwarm && Settings.DruidRestoUseAdaptiveSwarm,
          spell.cast("Adaptive Swarm", on => heal.getPriorityTarget())
        )
      )
    );
  }

  /******************************************
   * Dispels, Buffs, and Major Cooldowns
   ******************************************/
  
  handleDispels() {
    const priorityMap = {
      "Low": DispelPriority.Low,
      "Medium": DispelPriority.Medium,
      "High": DispelPriority.High
    };
    
    const priority = priorityMap[Settings.DruidRestoDispelPriority] || DispelPriority.Medium;
    
    return new bt.Decorator(
      req => Settings.DruidRestoUseNaturesCure,
      spell.dispel("Nature's Cure", true, priority, true, 
                WoWDispelType.Magic, WoWDispelType.Curse, WoWDispelType.Poison)
    );
  }

  handleBuffs() {
    return new bt.Selector(
      // Apply Mark of the Wild if missing
      spell.cast("Mark of the Wild", req => {
        const target = this.findMotwTarget();
        return target && !target.hasAura("Mark of the Wild");
      }),
      
      // Manage Efflorescence placement
      new bt.Decorator(
        req => this.shouldPlaceEfflorescence(),
        spell.cast("Efflorescence", on => this.getBestEfflorescenceLocation())
      )
    );
  }

  handleMajorCooldowns() {
    return new bt.Selector(
      // Use Tree of Life for major healing
      new bt.Decorator(
        req => this.talents.hasTreeOfLife && 
               Settings.DruidRestoUseTreeOfLife && 
               this.isHighDamageSituation() && 
               spell.canCast("Incarnation: Tree of Life") && 
               this.countCriticalHealTargets() >= Settings.DruidRestoTreeOfLifeMinTargets,
        spell.cast("Incarnation: Tree of Life")
      ),
      
      // Use Flourish to extend HoTs
      new bt.Decorator(
        req => this.talents.hasFlourish && 
               Settings.DruidRestoUseFlourish && 
               this.shouldUseFlourish(),
        spell.cast("Flourish")
      ),
      
      // Use Convoke the Spirits
      new bt.Decorator(
        req => this.talents.hasConvoke && 
               Settings.DruidRestoUseConvoke && 
               this.isHighDamageSituation() && 
               spell.canCast("Convoke the Spirits"),
        spell.cast("Convoke the Spirits")
      ),
      
      // Use Tranquility in extreme situations
      new bt.Decorator(
        req => this.countPriorityTargets(Settings.DruidRestoTransquilityPercent) >= 
               Settings.DruidRestoTransquilityMinTargets,
        spell.cast("Tranquility")
      )
    );
  }
  
  isHighDamageSituation() {
    // Count how many players are below 60% health
    let criticalCount = this.countPriorityTargets(60);
    
    // Or if tank is taking heavy damage
    const tankInDanger = heal.friends.Tanks.some(tank => tank.pctHealth < 40);
    
    return criticalCount >= 3 || tankInDanger;
  }
  
  countCriticalHealTargets() {
    return this.countPriorityTargets(50);
  }
  
  shouldUseFlourish() {
    // Count how many of our HoTs are active on group members
    let hotCount = 0;
    for (const unit of heal.friends.All) {
      if (unit.hasAuraByMe("Rejuvenation") || 
          unit.hasAuraByMe("Regrowth") || 
          unit.hasAuraByMe("Wild Growth") ||
          unit.hasAuraByMe("Lifebloom")) {
        hotCount++;
      }
    }
    
    // Use Flourish if we have several HoTs active and people need healing
    return hotCount >= Settings.DruidRestoFlourishMinHoTs && this.isHighDamageSituation();
  }
  
  // Helper functions for target counting
  countPriorityTargets(healthPercent) {
    return heal.priorityList.filter(unit => 
      unit.predictedHealthPercent < healthPercent &&
      unit.distanceTo(me) <= 40
    ).length;
  }
  
  countTargetsInRange(centerUnit, range, healthPercentThreshold = 100) {
    return heal.priorityList.filter(unit => 
      unit.distanceTo(centerUnit) <= range &&
      unit.predictedHealthPercent < healthPercentThreshold
    ).length;
  }
  /******************************************
   * Healing Rotations
   ******************************************/
  
  // Standard healing rotation for all contexts
  generalHealingRotation() {
    this.handleGroveGuardian();
    return new bt.Selector(
      // Use Overgrowth if talented
      new bt.Decorator(
        req => this.talents.hasOvergrowth && this.findOvergrowthTarget(),
        spell.cast("Overgrowth", on => this.findOvergrowthTarget())
      ),
      
      // Use Swiftmend to consume a HoT for fast healing
      spell.cast("Swiftmend", req => this.findSwiftmendTarget()),
      
      // Use Cenarion Ward on the tank
      new bt.Decorator(
        req => this.talents.hasCenarionWard,
        spell.cast("Cenarion Ward", req => this.findCenarionWardTarget())
      ),
      
      // Use Regrowth with Clearcasting proc
      spell.cast("Regrowth", 
        req => me.hasVisibleAura("Clearcasting") && 
               heal.getPriorityTarget()?.predictedHealthPercent < 90, 
        on => heal.getPriorityTarget()
      ),
      
      // Use Adaptive Swarm if talented
      new bt.Decorator(
        req => this.talents.hasAdaptiveSwarm && Settings.DruidRestoUseAdaptiveSwarm,
        spell.cast("Adaptive Swarm", req => this.findAdaptiveSwarmTarget())
      ),
      
      // Use Wild Growth for AoE healing
      spell.cast("Wild Growth", 
        req => this.shouldUseWildGrowth(),
        on => heal.getPriorityTarget()
      ),
      
      // Manage Lifebloom
      spell.cast("Lifebloom", req => this.findLifebloomTarget()),
      
      // Use Regrowth on low health targets
      spell.cast("Regrowth", req => this.findRegrowthTarget()),
      
      // Apply Rejuvenation
      spell.cast("Rejuvenation", req => this.findRejuvenationTarget())
    );
  }
  
  // Specialized rotation for raids
  // powerOfNature: 394045, // Power of Nature buff
  // masterShapeshifter: 393760, // Master Shapeshifter buff
  // naturesVigil: 124974, // Nature's Vigil buff/ability
  
  /**
   * Enhanced raid healing rotation focused on Tree of Life and Keeper of the Grove synergy
   */
  raidHealingRotation() {
    
    // Track number of active Grove Guardians for optimization
    const groveGuardianStacks = this.getGroveGuardianCharges();
    
    // Check Reforestation stack count for timing
    const reforestationStacks = this.getReforestationStacks();
    
    // Check if we're in a major cooldown window (Tree of Life or Reforestation proc)
    const inCooldownWindow = me.hasAura(auras.incarnationTree) || me.hasAura(auras.reforestation);
    
    // Check if Flourish will be available soon for syncing
    const flourishAvailableSoon = spell.getCooldown("Flourish").timeleft < 15;
    return new bt.Selector(
      // === MAJOR COOLDOWN WINDOWS ===
      // this.debugFunction(),
      
      new bt.Decorator(
        req => this.shouldSummonGroveGuardian(),
        spell.cast("Grove Guardians"),
      ),
        
      // Use Tree of Life with proper timing
      new bt.Decorator(
        req => this.talents.hasTreeOfLife && 
              Settings.DruidRestoUseTreeOfLife && 
              spell.canCast("Incarnation: Tree of Life") &&
              // Only use if we have 3 Grove Guardian charges for synergy
              (groveGuardianStacks.charges === 3 || 
                // Or if it's a high damage situation and we can't wait
                (this.isHighDamageSituation() && this.countCriticalHealTargets() >= Settings.DruidRestoTreeOfLifeMinTargets)),
        spell.cast("Incarnation: Tree of Life")
      ),
      
      // Use Nature's Vigil during cooldown windows with Flourish
      new bt.Decorator(
        req => spell.canCast("Nature's Vigil") && 
               (me.hasAura(auras.flourish) || 
                (inCooldownWindow && flourishAvailableSoon)),
        spell.cast("Nature's Vigil")
      ),
      
      // Use Innervate during ramp windows
      new bt.Decorator(
        req => spell.canCast("Innervate") && 
               inCooldownWindow && 
               me.pctPowerByType(PowerType.Mana) < 60,
        spell.cast("Innervate", on => me)
      ),
      
      // Use Flourish during major cooldown windows with good HoT coverage
      new bt.Decorator(
        req => this.talents.hasFlourish && 
               Settings.DruidRestoUseFlourish &&
               spell.canCast("Flourish") && 
               inCooldownWindow && 
               this.countActiveHoTs() >= Settings.DruidRestoFlourishMinHoTs,
        spell.cast("Flourish")
      ),
      
      // Trigger 3rd Reforestation stack when Flourish is ready
      new bt.Decorator(
        req => reforestationStacks === 2 && 
               flourishAvailableSoon && 
               groveGuardianStacks.charges === 3 && 
               spell.getCooldown("Swiftmend").timeleft === 0,
        spell.cast("Swiftmend", on => this.findSwiftmendTarget())
      ),
      
      // === BASIC HEALING MAINTENANCE ===
      
      // Keep Efflorescence down in optimal location
      new bt.Decorator(
        req => {
          this.shouldPlaceEfflorescence() ,
          spell.cast("Efflorescence,", on => this.findBestRaidEfflorescenceLocation())
          },
        ),
      
      
      // Manage Lifebloom on optimal target (usually tank)
      spell.cast("Lifebloom", req => {
        // Check if we've reached max Lifebloom targets
        let lifebloomCount = 0;
        const maxLifebloomTargets = this.talents.hasPhotosynthesis ? 3 : 1;
        
        for (const unit of heal.friends.All) {
          if (unit.hasAuraByMe("Lifebloom")) {
            lifebloomCount++;
          }
        }
        
        if (lifebloomCount >= maxLifebloomTargets) {
          // Only look for targets that need a refresh (under 5 seconds)
          const targetToRefresh = heal.priorityList.find(unit => {
            const lifebloom = unit.getAuraByMe("Lifebloom");
            return lifebloom && lifebloom.remainingTime <= 5000;
          });
          
          return targetToRefresh;
        }
        
        // Look for a target without Lifebloom
        // Prioritize tanks first
        const tank = heal.friends.Tanks.find(unit => 
          !unit.hasAuraByMe("Lifebloom") &&
          unit.distanceTo(me) <= 40 &&
          me.inCombat
        );
        
        if (tank) return tank;
        
        // Then other priority targets if we use Photosynthesis
        if (this.talents.hasPhotosynthesis) {
          const priorityTarget = heal.priorityList.find(unit => 
            !unit.hasAuraByMe("Lifebloom") &&
            unit.distanceTo(me) <= 40 &&
            me.inCombat
          );
          
          return priorityTarget;
        }
        this.debugFunction();
        return false;
      }),
      
      // Use Swiftmend + Wild Growth combo for Reforestation stacks
      new bt.Decorator(
        req => spell.canCast("Swiftmend") && 
               spell.canCast("Wild Growth") && 
               reforestationStacks < 3 && 
               this.countPriorityTargets(Settings.DruidRestoWildGrowthPercent) >= 
               Math.max(2, Settings.DruidRestoWildGrowthMinTargets - 1),
        new bt.Sequence(
          spell.cast("Swiftmend", req => this.findSwiftmendTarget()),
          spell.cast("Wild Growth")
        )
      ),
      
      // Use Wild Growth more aggressively in raids
      spell.cast("Wild Growth", 
        req => this.countPriorityTargets(Settings.DruidRestoWildGrowthPercent) >= 
               Math.max(2, Settings.DruidRestoWildGrowthMinTargets - 1)
      ),
      
      // Apply Rejuvenation to prepare for incoming damage
      // More aggressive in raid context to build Abundance stacks
      spell.cast("Rejuvenation", req => {
        // Target needs rejuv and doesn't have it
        const target = heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoRejuvenationPercent && 
          !unit.hasAuraByMe("Rejuvenation") &&
          unit.distanceTo(me) <= 40
        );
        
        // Add additional logic to maintain some rejuvs for Abundance/procs
        if (target) {
          return target;
        }
        
        // If we have Abundance talent, keep more rejuvs active
        if (this.talents.hasAbundance && this.countRejuvenations() < 6) {
          // Find any valid target without rejuv
          return heal.friends.All.find(unit => 
            !unit.hasAuraByMe("Rejuvenation") && 
            unit.distanceTo(me) <= 40
          );
        }
        
        return false;
      }),
      
      // Use Regrowth with Abundance during Tree of Life or Reforestation
      new bt.Decorator(
        req => this.talents.hasAbundance && 
               (me.hasAura(auras.incarnationTree) || me.hasAura(auras.reforestation)),
        spell.cast("Regrowth", req => {
          // Find target needing healing that doesn't have Regrowth
          const target = heal.priorityList.find(unit => 
            unit.predictedHealthPercent < 85 && 
            !unit.hasAuraByMe("Regrowth") &&
            unit.distanceTo(me) <= 40
          );
          
          return target;
        })
      ),
      
      // Use Nature's Swiftness for emergency healing
      new bt.Decorator(
        req => spell.canCast("Nature's Swiftness") &&
               heal.getPriorityTarget()?.predictedHealthPercent < 45,
        new bt.Sequence(
          spell.cast("Nature's Swiftness"),
          spell.cast("Regrowth", on => heal.getPriorityTarget())
        )
      ),
      
      // === UTILITY AND DEFENSIVE ===
      
      // Use Ironbark on endangered tanks or allies
      spell.cast("Ironbark", req => {
        // First check tanks
        const endangeredTank = heal.friends.Tanks.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoIronbarkThreshold &&
          unit.distanceTo(me) <= 40
        );
        
        if (endangeredTank) return endangeredTank;
        
        // Then check any priority target
        const endangeredAlly = heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoIronbarkThreshold * 0.8 &&
          unit.distanceTo(me) <= 40
        );
        
        return endangeredAlly;
      }),
      
      // Cast Wrath during downtime for Master Shapeshifter mana regen
      new bt.Decorator(
        req => Settings.DruidRestoEnableDPS && 
               !this.needHealing() && 
               me.pctPowerByType(PowerType.Mana) < 80 && 
               me.target,
        spell.cast("Wrath")
      ),
      
      // Maintain Moonfire for DPS optimization
      new bt.Decorator(
        req => Settings.DruidRestoEnableDPS && 
               !this.needHealing() && 
               me.target,
        spell.cast("Moonfire", req => this.shouldRefreshMoonfire())
      ),
      
      // Fallback to general healing rotation
      this.generalHealingRotation()
    );
  }
  
  /**
   * Helper method to get Reforestation stacks
   */
  getReforestationStacks() {
    const reforestation = me.getAura("Reforestation");
    if (reforestation) {
      return reforestation.stacks || 0;
    }
    return 0;
  }
  
  /**
   * Count active HoTs on all raid members
   */
  countActiveHoTs() {
    let hotCount = 0;
    
    for (const unit of heal.friends.All) {
      if (unit.hasAuraByMe("Rejuvenation")) hotCount++;
      if (unit.hasAuraByMe("Regrowth")) hotCount++;
      if (unit.hasAuraByMe("Wild Growth")) hotCount++;
      if (unit.hasAuraByMe("Lifebloom")) hotCount++;
      if (unit.hasAuraByMe("Spring Blossoms") && this.talents.hasSpringBlossoms) hotCount++;
      if (unit.hasAuraByMe("Cultivation") && this.talents.hasCultivation) hotCount++;
    }
    
    return hotCount;
  }
  
  /**
   * Count active Rejuvenations
   */
  countRejuvenations() {
    return heal.friends.All.filter(unit => 
      unit.hasAuraByMe("Rejuvenation")
    ).length;
  }
  
  // Specialized rotation for Mythic+
  mythicPlusRotation() {
    return new bt.Selector(
      // Use Adaptive Swarm more aggressively in M+
      new bt.Decorator(
        req => this.talents.hasAdaptiveSwarm && Settings.DruidRestoUseAdaptiveSwarm,
        spell.cast("Adaptive Swarm", req => {
          const tank = heal.friends.Tanks.find(unit => 
            unit.predictedHealthPercent < 85 && !unit.hasAuraByMe("Adaptive Swarm")
          );
          return tank || this.findAdaptiveSwarmTarget();
        })
      ),
      
      // Prioritize Swiftmend for burst healing
      spell.cast("Swiftmend", req => this.findSwiftmendTarget(false, true)),
      
      // Keep Lifebloom on tank at all times
      spell.cast("Lifebloom", req => {
        const tank = heal.friends.Tanks.find(unit => 
          !unit.hasAuraByMe("Lifebloom") && unit.distanceTo(me) <= 40
        );
        return tank;
      }),
      
      // Fall back to general healing rotation
      this.generalHealingRotation()
    );
  }
  
  // Specialized rotation for tank healing
  tankHealingRotation() {
    return new bt.Selector(
      // Focus Ironbark on main tank
      spell.cast("Ironbark", req => {
        const tank = heal.friends.Tanks.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoIronbarkThreshold && 
          !unit.hasAura("Ironbark") && 
          unit.distanceTo(me) <= 40
        );
        return tank;
      }),
      
      // Keep Cenarion Ward on tank
      new bt.Decorator(
        req => this.talents.hasCenarionWard,
        spell.cast("Cenarion Ward", on => {
          const tank = heal.friends.Tanks.find(unit => 
            !unit.hasAuraByMe("Cenarion Ward") && unit.distanceTo(me) <= 40
          );
          return tank;
        })
      ),
      
      // Lifebloom on tank
      spell.cast("Lifebloom", req => {
        const tank = heal.friends.Tanks.find(unit => 
          !unit.hasAuraByMe("Lifebloom") && unit.distanceTo(me) <= 40
        );
        return tank;
      }),
      
      // Rejuvenation on tank
      spell.cast("Rejuvenation", req => {
        const tank = heal.friends.Tanks.find(unit => 
          !unit.hasAuraByMe("Rejuvenation") && unit.distanceTo(me) <= 40
        );
        return tank;
      }),
      
      // Swiftmend for emergency tank healing
      spell.cast("Swiftmend", req => {
        const tank = heal.friends.Tanks.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoSwiftmendPercent && 
          (unit.hasAuraByMe("Rejuvenation") || unit.hasAuraByMe("Regrowth") || unit.hasAuraByMe("Wild Growth")) &&
          unit.distanceTo(me) <= 40
        );
        return tank;
      }),
      
      // Fall back to general healing rotation
      this.generalHealingRotation()
    );
  }
  
  // Specialized rotation for PvP healing
  pvpHealingRotation() {
    return new bt.Selector(
      // Abolish Poison (if applicable in current version)
      spell.cast("Abolish Poison", req => {
        const poisonedTarget = heal.friends.All.find(unit => 
          unit.hasAuraOfDispelType(WoWDispelType.Poison) && 
          unit.distanceTo(me) <= 40
        );
        return poisonedTarget;
      }),
      
      // Remove Corruption (if applicable in current version)
      spell.cast("Remove Corruption", req => {
        const cursedTarget = heal.friends.All.find(unit => 
          unit.hasAuraOfDispelType(WoWDispelType.Curse) && 
          unit.distanceTo(me) <= 40
        );
        return cursedTarget;
      }),
      
      // Instant cast healing prioritized in PvP
      spell.cast("Swiftmend", req => {
        const target = heal.priorityList.find(unit => 
          unit.predictedHealthPercent < Settings.DruidRestoSwiftmendPercent && 
          (unit.hasAuraByMe("Rejuvenation") || unit.hasAuraByMe("Regrowth") || unit.hasAuraByMe("Wild Growth")) &&
          unit.distanceTo(me) <= 40
        );
        return target;
      }),
      
      // Barkskin proactively when taking damage in PvP
      new bt.Decorator(
        req => Settings.DruidRestoUseBarkskin && 
               me.InCombat && 
               me.pctHealth < 80,
        spell.cast("Barkskin", on => me)
      ),
      
      // Fall back to general healing rotation
      this.generalHealingRotation()
    );
  }

  /******************************************
   * Target Finding Functions
   ******************************************/
  
  findMotwTarget() {
    const motwTarget = heal.friends.All.find(unit => !unit.hasVisibleAura("Mark of the Wild"));
    return motwTarget || false;
  }

  findSwiftmendTarget(emergency = false, prioritizeTanks = false) {
    const threshold = emergency ? 
      Settings.DruidRestoPanicThreshold : 
      Settings.DruidRestoSwiftmendPercent;
    
    // First look for tanks if prioritizing them
    if (prioritizeTanks || Settings.DruidRestoPrioritizeTanks) {
      for (const tank of heal.friends.Tanks) {
        if (tank.predictedHealthPercent < threshold && 
            (tank.hasAuraByMe("Rejuvenation") || 
             tank.hasAuraByMe("Regrowth") || 
             tank.hasAuraByMe("Wild Growth")) &&
            tank.distanceTo(me) <= 40) {
          return tank;
        }
      }
    }
    
    // Then check all other units
    for (const unit of heal.priorityList) {
      if (unit.predictedHealthPercent < threshold && 
          (unit.hasAuraByMe("Rejuvenation") || 
           unit.hasAuraByMe("Regrowth") || 
           unit.hasAuraByMe("Wild Growth")) &&
          unit.distanceTo(me) <= 40) {
        return unit;
      }
    }
    
    return false;
  }

  findRegrowthTarget() {
    // Apply prioritization based on talents
    const threshold = Settings.DruidRestoRegrowthPercent;
    
    // First look for tanks if prioritizing them
    if (Settings.DruidRestoPrioritizeTanks) {
      for (const tank of heal.friends.Tanks) {
        if (tank.predictedHealthPercent < threshold && 
            !tank.hasAuraByMe("Regrowth") &&
            tank.distanceTo(me) <= 40) {
          return tank;
        }
      }
    }
    
    // Consider Abundance and stack priority if talented
    if (this.talents.hasAbundance) {
      const candidates = heal.priorityList.filter(unit => 
        unit.predictedHealthPercent < threshold && 
        !unit.hasAuraByMe("Regrowth") &&
        unit.distanceTo(me) <= 40
      );
      
      // With Abundance, prioritize targets with more Rejuv stacks
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const aHasRejuv = a.hasAuraByMe("Rejuvenation") ? 1 : 0;
          const bHasRejuv = b.hasAuraByMe("Rejuvenation") ? 1 : 0;
          
          // First sort by Rejuvenation
          if (aHasRejuv !== bHasRejuv) {
            return bHasRejuv - aHasRejuv;
          }
          
          // Then by health
          return a.predictedHealthPercent - b.predictedHealthPercent;
        });
        
        return candidates[0];
      }
    }
    
    // Standard target finding
    return this.findHealOverTimeTarget("Regrowth", 
      unit => unit.predictedHealthPercent < threshold
    );
  }

  findRejuvenationTarget() {
    const threshold = Settings.DruidRestoRejuvenationPercent;
    
    // First look for tanks if prioritizing them
    if (Settings.DruidRestoPrioritizeTanks) {
      for (const tank of heal.friends.Tanks) {
        if (tank.predictedHealthPercent < threshold && 
            !tank.hasAuraByMe("Rejuvenation") &&
            tank.distanceTo(me) <= 40) {
          return tank;
        }
      }
    }
    
    // Then check all other units
    return this.findHealOverTimeTarget("Rejuvenation", 
      unit => unit.predictedHealthPercent < threshold
    );
  }

  findCenarionWardTarget() {
    // Prioritize tanks first
    if (heal.friends.Tanks.length > 0) {
      const tank = heal.friends.Tanks[0];
      if (tank.predictedHealthPercent < Settings.DruidRestoCenarionWardThreshold && 
          !tank.hasAuraByMe("Cenarion Ward") &&
          tank.distanceTo(me) <= 40) {
        return tank;
      }
    }
    
    // Then any priority target
    const target = heal.getPriorityTarget();
    if (target && 
        target.predictedHealthPercent < 80 && 
        !target.hasAuraByMe("Cenarion Ward") &&
        target.distanceTo(me) <= 40) {
      return target;
    }
    
    return false;
  }

  shouldUseWildGrowth() {
    let damagedUnitsCount = 0;
    const threshold = Settings.DruidRestoWildGrowthPercent;
    
    for (const unit of heal.priorityList) {
      if (unit.predictedHealthPercent < threshold && 
          unit.distanceTo(me) <= 30) {
        damagedUnitsCount++;
      }
    }
    
    return damagedUnitsCount >= Settings.DruidRestoWildGrowthMinTargets;
  }
  
  shouldPlaceEfflorescence() {
    // Count how many injured allies would benefit from it
    let potentialTargets = 0;
    const bestLocation = this.getBestEfflorescenceLocation();
    
    for (const unit of heal.friends.All) {
      if (unit.predictedHealthPercent < Settings.DruidRestoEfflorescencePercent && 
          bestLocation && 
          unit.distanceTo(bestLocation) < 10) {
        potentialTargets++;
      }
    }
    
    return potentialTargets >= Settings.DruidRestoEfflorescenceMinTargets;
  }
  
  getBestEfflorescenceLocation() {
   const allUnits = [...heal.friends.All, ...combat.targets];
       const tank = this.getTank();
   
       let bestPosition = null;
       let maxUnitsInRange = 0;
   
       // Function to count units within range of a position
       const countUnitsInRange = (position, units) => {
         return units.filter(unit => unit.distanceTo(position) <= EFFLORESCENCE_RADIUS).length;
       };
   
       // Check each unit's position as a potential center
       allUnits.forEach(centerUnit => {
         const position = centerUnit.position;
         let unitsInRange;
   
         
           const friendsInRange = countUnitsInRange(position, heal.friends.All);
           
             unitsInRange = 0; // Don't consider positions without the tank
           
         
   
         if (unitsInRange > maxUnitsInRange) {
           maxUnitsInRange = unitsInRange;
           bestPosition = position;
         }
       });
   
       return bestPosition || me;
  }
  
  findBestRaidEfflorescenceLocation() {
    // Find the unit that will affect the most injured allies
    let bestUnit = null;
    let maxCoveredTargets = 0;
    
    // For each possible unit, count how many would be in range
    for (const centralUnit of heal.friends.All) {
      if (centralUnit.distanceTo(me) > 40) continue;
      
      let coveredTargets = 0;
      for (const unit of heal.friends.All) {
        if (unit.predictedHealthPercent < Settings.DruidRestoEfflorescencePercent && 
            unit.distanceTo(centralUnit) < 10) {
          coveredTargets++;
        }
      }
      
      if (coveredTargets > maxCoveredTargets) {
        maxCoveredTargets = coveredTargets;
        bestUnit = centralUnit;
      }
    }
    
    return bestUnit || heal.getPriorityTarget() || me;
  }

  findLifebloomTarget() {
    // Count how many Lifeblooms we have active
    let lifebloomTargets = 0;
    
    // Get the maximum number of Lifebloom targets based on talents
    const maxLifebloomTargets = this.talents.hasPhotosynthesis ? 3 : 1;
    
    // Count current active Lifebloom applications
    for (const unit of heal.friends.All) {
      if (unit.hasAuraByMe("Lifebloom")) {
        lifebloomTargets++;
      }
    }
    
    // If we already have maximum number of Lifeblooms active, check if any need refreshing
    if (lifebloomTargets >= maxLifebloomTargets) {
      // Look for a Lifebloom that needs refreshing (below 5 seconds)
      for (const unit of heal.priorityList) {
        const lifebloom = unit.getAuraByMe("Lifebloom");
        if (lifebloom && lifebloom.remainingTime <= 5000) {
          return unit; // Return this unit to refresh their Lifebloom
        }
      }
      
      // All Lifeblooms are good, no need to cast
      return false;
    }
    
    // We don't have max Lifeblooms, so try to apply new ones
    
    // First priority: tanks without Lifebloom
    for (const tank of heal.friends.Tanks) {
      if (!tank.hasAuraByMe("Lifebloom") && 
          tank.distanceTo(me) <= 40 && 
          me.inCombat) { // Only apply to tanks in combat
        return tank;
      }
    }
    
    // Second priority: other priority targets if we have Photosynthesis
    if (this.talents.hasPhotosynthesis && lifebloomTargets < maxLifebloomTargets) {
      for (const unit of heal.priorityList) {
        if (!unit.hasAuraByMe("Lifebloom") && 
            unit.predictedHealthPercent < 85 && 
            unit.distanceTo(me) <= 40 && 
            me.inCombat) { // Only apply in combat
          return unit;
        }
      }
    }
    
    // No valid targets found
    return false;
  }
  
  findAdaptiveSwarmTarget() {
    // Healing adaptive swarm on low health targets
    for (const unit of heal.priorityList) {
      if (unit.predictedHealthPercent < 70 && 
          !unit.hasAuraByMe("Adaptive Swarm") &&
          unit.distanceTo(me) <= 40) {
        return unit;
      }
    }
    
    // Damaging adaptive swarm on enemies if in offensive mode
    if (Settings.DruidRestoEnableDPS && me.target && !me.target.hasAuraByMe("Adaptive Swarm")) {
      return me.target;
    }
    
    return false;
  }
  
  getTank() {
    return heal.friends.Tanks[0] || me; // Fallback to 'me' if no tank is found
  }

  getTanks() {
    return heal.friends.Tanks.filter(tank => tank !== null);
  }

  findOvergrowthTarget() {
    // Prioritize tanks that need multiple HoTs
    for (const tank of heal.friends.Tanks) {
      if (tank.predictedHealthPercent < 80 && 
          (!tank.hasAuraByMe("Rejuvenation") || 
           !tank.hasAuraByMe("Regrowth") || 
           !tank.hasAuraByMe("Wild Growth")) &&
          tank.distanceTo(me) <= 40) {
        return tank;
      }
    }
    
    // Then any critical unit
    for (const unit of heal.priorityList) {
      if (unit.predictedHealthPercent < 50 && 
          (!unit.hasAuraByMe("Rejuvenation") || 
           !unit.hasAuraByMe("Regrowth") || 
           !unit.hasAuraByMe("Wild Growth")) &&
          unit.distanceTo(me) <= 40) {
        return unit;
      }
    }
    
    return false;
  }

  findHealOverTimeTarget(spellName, predicate, sortFn = null) {
    // Filter units that need the HoT and don't have it
    const candidates = heal.priorityList.filter(unit => 
      predicate(unit) && 
      !unit.hasAuraByMe(spellName) &&
      unit.distanceTo(me) <= 40
    );
    
    // If we have a sort function, sort by it
    if (sortFn && candidates.length > 1) {
      candidates.sort(sortFn);
    }
    
    return candidates.length > 0 ? candidates[0] : false;
  }

  /******************************************
   * DPS Rotation
   ******************************************/
  
  handleDamageDealing() {
    if (!Settings.DruidRestoEnableDPS) {
      return new bt.Action(() => bt.Status.Failure);
    }
    
    // Check if healing is needed before doing damage
    const needsHealing = heal.priorityList.some(unit => unit.predictedHealthPercent < 90);
    if (needsHealing) return new bt.Action(() => bt.Status.Failure);
    
    return new bt.Selector(
      common.waitForTarget(),
      
      // Apply Moonfire if missing or about to expire
      spell.cast("Moonfire", req => this.shouldRefreshMoonfire()),
      
      // Apply Sunfire if missing or about to expire
      new bt.Decorator(
        req => Settings.DruidRestoUseSunfire,
        spell.cast("Sunfire", req => this.shouldRefreshSunfire())
      ),
      
      // Use Wrath as filler
      spell.cast("Wrath", req => me.target && !this.needHealing())
    );
  }
  
  shouldRefreshMoonfire() {
    if (!me.target) return false;
    
    const moonfire = me.target.getAuraByMe("Moonfire");
    return !moonfire || 
           moonfire.remainingTime < Settings.DruidRestoMoonfireRefreshThreshold;
  }
  
  shouldRefreshSunfire() {
    if (!me.target) return false;
    
    const sunfire = me.target.getAuraByMe("Sunfire");
    return (!sunfire || 
            sunfire.remainingTime < Settings.DruidRestoSunfireRefreshThreshold) && 
           combat.targets.length > 1;
  }

  /******************************************
   * Grove Guardian Management - Improved
   ******************************************/
  
  // Add to auras object at the top of the file:
  // keeperOfTheGrove: 395833, // Keeper of the Grove talent
  
 // Replace the handleGroveGuardian function with this corrected version
handleGroveGuardian() {
  // Skip if the talent isn't selected or feature is disabled
  if (!this.talents.hasGroveGuardian || !Settings.DruidRestoUseGroveGuardian) {
    return new bt.Action(() => bt.Status.Failure);
  }

  // Create a proper behavior tree selector for Grove Guardian handling
  return new bt.Selector(
    // First check if we need to summon
    new bt.Decorator(
      req => this.shouldSummonGroveGuardian(),
      // If we should summon, cast the spell
      spell.cast("Grove Guardians", on => me)
    ),
    // Always return failure if we didn't summon so rotation continues
    new bt.Action(() => bt.Status.Failure)
  );
}

// Add this new method to determine if we should summon
shouldSummonGroveGuardian() {
  // Initialize tracking variables if needed
  if (!this._variables.lastGroveGuardianTime) {
    this._variables.lastGroveGuardianTime = 0;
    this._variables.groveGuardiansUsed = 0;
  }
  
  // Get current state information
  const inRampWindow = me.hasAura(auras.incarnationTree) || me.hasAura(auras.reforestation);
  const currentTime = Date.now() / 1000;
  const guardianCooldown = 1.5; // Minimum time between summons to prevent spamming
  
  // Check if we already have 3 active guardians
  if (this.countActiveGroveGuardians() >= 3) {
    // console.log("Already have 3 active guardians");
    return false;
  }
  
  // Check time since last summon to prevent spamming
  if ((currentTime - this._variables.lastGroveGuardianTime) <= guardianCooldown) {
  //  console.log("Too soon since last summon attempt");
    return false;
  }
  
  // Check if we can cast the spell at all
  if (!spell.cast("Grove Guardians")) {
    // console.log("Cannot cast Grove Guardians");
    return false;
  }

  // Check if we can cast the spell at all
  if (!me.inCombat()) {
    return false;
  }
  
  // Get charge information more reliably
  let charges = 0;
  try {
    charges = spell.getCharges("Grove Guardians");
    // console.log(`Grove Guardian charges: ${charges}`);
  } catch (error) {
    // console.log(`Error getting charges: ${error.message}`);
  }
  
  // Determine if we should summon based on context
 this.shouldSummon = false;
  
  // Case 1: During major cooldown windows, use aggressively
  if (inRampWindow) {
    // console.log("In ramp window - summoning");
    return true;
  } 
  // Case 2: In healing-intensive situations
  else if (this.isHighDamageSituation()) {
    // console.log("High damage situation - summoning");
    return true;
  }
  // Case 3: When we have high charges available (avoid overcapping)
  else if (charges > 2) {
    // console.log("High charges available - summoning");
    return true;
  }
  // Case 4: In combat with at least 1 charge and someone needs healing
  else if (me.inCombat && charges > 0 && this.needHealing()) {
    // console.log("In combat with healing needed - summoning");
    return true;
  }
  
  // If we're going to summon, update tracking variables
  if (this.shouldSummon) {
    this._variables.lastGroveGuardianTime = currentTime;
    this._variables.groveGuardiansUsed = (this._variables.groveGuardiansUsed || 0) + 1;
    // console.log(`Grove Guardian summoning (${this._variables.groveGuardiansUsed})`);
  } else {
    // console.log("Not summoning Grove Guardian");
  }
  
  return false;
}

// SIMPLIFIED PET COUNTING FUNCTION
countActiveGroveGuardians() {
  let count = 0;
      
      // Durchsuche alle Objekte im ObjectManager
        objMgr.objects.forEach(obj => {
            // Prüfe, ob das Objekt eine Einheit ist
            if (obj instanceof wow.CGUnit) {
                // Prüfe, ob die Einheit vom Spieler beschworen wurde und ein Wild Imp ist
                if (obj.createdBy && 
                    me.guid && 
                    obj.createdBy.equals(me.guid) && 
                    obj.name === 'Treant') {
                    count++;
                }
            }
        });
          return count > 0 ? count : 0;
  
  
}

// Update getGroveGuardianCharges to be more reliable
getGroveGuardianCharges() {
  try {
    // Try to get spell cooldown info
    const cooldownInfo = spell.getCharges("Grove Guardians");
    if (cooldownInfo) {
      return {
        charges: cooldownInfo || 0,
        maxCharges: 3
      };
    }
  } catch (error) {
    console.log(`Error getting Grove Guardian charges: ${error.message}`);
  }
  
  // Default fallback
  return {
    charges: spell.canCast("Grove Guardians") ? 1 : 0,
    maxCharges: 3
  };
}
  
  
  
  /**
   * Checks if a pet is a Grove Guardian
   */
  isGroveGuardianPet(pet) {
    if (!pet) return false;
    
    // More robust checks for identifying Grove Guardian pets
    return pet.name === "Treant" || 
           pet.name.includes("Treant") ||
           pet.id === 194958 || // Pet ID for Grove Guardian
           (pet.auras && pet.auras.some(aura => 
             aura.id === auras.groveGuardian || 
             aura.id === auras.groveGuardianPet
           ));
  }

  // Improved rejuvenation target finding with max target check
  findRejuvenationTarget() {
    const threshold = Settings.DruidRestoRejuvenationPercent;
    
    // Calculate max Rejuvenation targets based on settings
    let maxRejuvenationTargets = Settings.DruidRestoMaxRejuvenationTargets || 8;
    
    // Scale with raid size if enabled
    if (Settings.DruidRestoScaleRejuvWithRaidSize) {
      const raidSize = heal.friends.All.length;
      if (raidSize <= 5) {
        maxRejuvenationTargets = Math.min(maxRejuvenationTargets, 3); // 5-player content
      } else if (raidSize <= 10) {
        maxRejuvenationTargets = Math.min(maxRejuvenationTargets, 5); // 10-player content
      }
      // For 20+ players, use the full setting value
    }
    
    // Increase if we have Abundance talent and the setting is enabled
    if (this.talents.hasAbundance && Settings.DruidRestoIncreasedRejuvWithAbundance) {
      maxRejuvenationTargets += 2; // Add 2 more for Abundance benefit
    }
    
    // Count current rejuvenations
    const currentRejuvCount = this.countRejuvenations();
    
    // If we're already at or above the max, only refresh existing ones that are about to expire
    if (currentRejuvCount >= maxRejuvenationTargets) {
      // Look for rejuvenations about to expire
      for (const unit of heal.priorityList) {
        const rejuv = unit.getAuraByMe("Rejuvenation");
        // Only refresh if less than 3 seconds remaining
        if (rejuv && rejuv.remainingTime <= 3000 && unit.predictedHealthPercent < threshold) {
          return unit;
        }
      }
      
      // If we need more rejuvs for Abundance stacks in Tree of Life
      if (this.talents.hasAbundance && me.hasAura(auras.incarnationTree) && currentRejuvCount < 10) {
        // Look for any targets without Rejuvenation during Tree of Life
        const target = heal.priorityList.find(unit => 
          !unit.hasAuraByMe("Rejuvenation") && 
          unit.distanceTo(me) <= 40
        );
        return target;
      }
      
      return false; // Already at max, and no urgent refreshes needed
    }
    
    // First look for tanks if prioritizing them
    if (Settings.DruidRestoPrioritizeTanks) {
      for (const tank of heal.friends.Tanks) {
        if (tank.predictedHealthPercent < threshold && 
            !tank.hasAuraByMe("Rejuvenation") &&
            tank.distanceTo(me) <= 40) {
          return tank;
        }
      }
    }
    
    // Then check all other units based on health threshold
    const target = heal.priorityList.find(unit => 
      unit.predictedHealthPercent < threshold && 
      !unit.hasAuraByMe("Rejuvenation") &&
      unit.distanceTo(me) <= 40
    );
    
    // Finally, if we have Abundance and need to build stacks
    if (!target && 
        this.talents.hasAbundance && 
        currentRejuvCount < maxRejuvenationTargets * 0.75 && // Only fill up to 75% of max
        Settings.DruidRestoIncreasedRejuvWithAbundance) {
      // Look for any eligible unit without Rejuvenation
      return heal.friends.All.find(unit => 
        !unit.hasAuraByMe("Rejuvenation") && 
        unit.distanceTo(me) <= 40
      );
    }
    
    return target || false;
  }

  createDebugPanel() {
    // Skip if UI system is not available
    if (typeof ui === 'undefined' || !ui.createDebugPanel) {
      return;
    }
    
    try {
      // Create panel if it doesn't exist
      if (!this._variables.debugPanel) {
        this._variables.debugPanel = ui.createDebugPanel("Resto Druid Debug", {
          width: 300,
          height: 200,
          position: "topright"
        });
      }
      
      // Get current Grove Guardian state
      const ggCharges = this.getGroveGuardianCharges();
      const activeGG = this.countActiveGroveGuardians();
      const inRampWindow = me.hasAura(auras.incarnationTree) || me.hasAura(auras.reforestation);
      
      // Calculate time since last summon
      const currentTime = Date.now() / 1000;
      const timeSinceLastSummon = this._variables.lastGroveGuardianTime ? 
        Math.floor(currentTime - this._variables.lastGroveGuardianTime) : 
        "N/A";
      
      // Get healing metrics
      const rejuvCount = this.countRejuvenations();
      const maxRejuvs = Settings.DruidRestoMaxRejuvenationTargets || 8;
      
      // Update panel content
      this._variables.debugPanel.update({
        title: "Resto Druid Debug",
        content: [
          { 
            type: "progressBar", 
            label: "Grove Guardian Charges", 
            value: ggCharges.charges, 
            max: 3,
            color: ggCharges.charges === 3 ? "#00ff00" : "#ffcc00"
          },
          {
            type: "text",
            text: `Active Guardians: ${activeGG}/3`,
            color: activeGG > 0 ? "#00ff99" : "#ffffff"
          },
          {
            type: "text",
            text: `Ramp Window: ${inRampWindow ? "ACTIVE!" : "Inactive"}`,
            color: inRampWindow ? "#ff3399" : "#888888"
          },
          {
            type: "text",
            text: `Last Summon: ${timeSinceLastSummon} seconds ago`,
            color: "#cccccc"
          },
          { 
            type: "progressBar", 
            label: "Rejuvenation", 
            value: rejuvCount, 
            max: maxRejuvs,
            color: "#33ccff"
          },
          {
            type: "separator"
          },
          {
            type: "text",
            text: "Cooldowns:",
            color: "#ffffff"
          },
          {
            type: "text",
            text: `Tree: ${this.getCooldownText("Incarnation: Tree of Life")}`,
            color: spell.canCast("Incarnation: Tree of Life") ? "#00ff00" : "#ff5555"
          },
          {
            type: "text",
            text: `Flourish: ${this.getCooldownText("Flourish")}`,
            color: spell.canCast("Flourish") ? "#00ff00" : "#ff5555"
          }
        ]
      });
    } catch (error) {
      console.log(`Debug panel error: ${error.message}`);
    }
  }
  
  /**
   * Helper method to format cooldown text
   */
  getCooldownText(spellName) {
    const cd = spell.getCooldown(spellName);
    if (!cd) return "N/A";
    
    if (cd.timeleft === 0) {
      return "READY";
    } else {
      const seconds = Math.ceil(cd.timeleft / 1000);
      return `${seconds}s`;
    }
  }

  /**
   * Debug function that runs on every tick to track important metrics
   * Place this in your behavior tree to ensure it runs every tick
   */
  debugFunction() {
    // Create a debug node that always returns failure to continue the rotation
    return new bt.Action(() => {
      try {
        const currentTime = Date.now() / 1000;
        
        // Always update the debug panel on every tick if it exists
        // This ensures real-time Grove Guardian tracking
        this.createDebugPanel();
        
        // Only log text messages every few seconds to avoid spam
        if (!this._variables.lastDebugTime || (currentTime - this._variables.lastDebugTime) > 3) {
          this._variables.lastDebugTime = currentTime;
          
          // Get Grove Guardian status
          const groveGuardianCharges = this.getGroveGuardianCharges();
          const activeGuardians = this.countActiveGroveGuardians();
          
          // Get healing metrics
          const rejuvCount = this.countRejuvenations();
          const hotCount = this.countActiveHoTs();
          const inRampWindow = me.hasAura(auras.incarnationTree) || me.hasAura(auras.reforestation);
          const priorityTargetHealth = heal.getPriorityTarget()?.predictedHealthPercent || 100;
          
          // Display targeting info for Grove Guardian debugging
          const targetInfo = me.target ? 
            `Target: ${me.target.name} (${me.target.id}) at ${me.distanceTo(me.target)}yd` : 
            "No target";
          
          // Create debug message with enhanced Grove Guardian info
          const debugMsg = [
            `=== RESTO DRUID DEBUG (${new Date().toLocaleTimeString()}) ===`,
            `Grove Guardian: ${groveGuardianCharges.charges}/${3} charges, ${this.shouldSummonGroveGuardian()}`,
            
          ].join("\n");
          
          // Log to console with color for visibility
          console.log("%c" + debugMsg, "color: #00ff99; font-weight: bold;");
          
          // Optional: Show on-screen debugging if available in your addon framework
          if (typeof ui !== 'undefined' && ui.debug) {
            ui.debug(debugMsg);
          }
        }
      } catch (error) {
        console.log(`Debug function error: ${error.message}`);
      }
      
      // Always return failure to continue the rotation
      return bt.Status.Failure;
    });
  }

}