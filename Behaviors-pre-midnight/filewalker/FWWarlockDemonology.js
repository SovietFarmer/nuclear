import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from "@/Core/Settings";
import objMgr from "@/Core/ObjectManager";
import CombatTimer from "@/Core/CombatTimer";
import { me } from '@/Core/ObjectManager';
import Pet from "@/Core/Pet";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from '@/Targeting/CombatTargeting';

// Define auras and spell IDs for easier reference
const auras = {
  tyrant: 265273,
  demonicCore: 264173,
  powerSiphon: 334581,
  demonicCalling: 205146,
  dreadstalkers: 193332,
  grimFelguard: 111898,
  vilefiend: 264119,
  diabolicsRitualMother: 405764,
  diabolicsRitualOverlord: 405761,
  diabolicsRitualPitLord: 405765,
  bloodlust: 2825
};

const debuffs = {
  doom: 603
};

const spells = {
  summonDemonicTyrant: 'Summon Demonic Tyrant',
  callDreadstalkers: 'Call Dreadstalkers',
  handOfGuldan: 'Hand of Gul\'dan',
  demonbolt: 'Demonbolt',
  shadowBolt: 'Shadow Bolt',
  summonVilefiend: 'Summon Vilefiend',
  grimoireFelguard: 'Grimoire: Felguard',
  implosion: 'Implosion',
  powerSiphon: 'Power Siphon',
  demonicStrength: 'Demonic Strength',
  ruination: 'Ruination',
  infernalBolt: 'Infernal Bolt'
};

// Global history tracker for spell casting
const spellHistory = {
  lastSpells: [],
  recordSpell: function(name) {
    this.lastSpells.unshift({ 
      name: name, 
      timestamp: Date.now() 
    });
    if (this.lastSpells.length > 10) {
      this.lastSpells.pop();
    }
  },
  wasPrevGcd: function(spellName, position = 1) {
    if (position < 1 || position > this.lastSpells.length) {
      return false;
    }
    const index = position - 1;
    return this.lastSpells[index] && 
           this.lastSpells[index].name.toLowerCase() === spellName.toLowerCase();
  }
};

export class DemonologyWarlockBehavior extends Behavior {
  name = 'FW Demonology Warlock';
  context = BehaviorContext.Any;
  specialization = Specialization.Warlock.Demonology;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Cooldowns",
      options: [
        { uid: "DemoUsePotion", text: "Use Potion", type: "checkbox", default: true },
        { uid: "DemoUseTrinkets", text: "Use Trinkets", type: "checkbox", default: true }
      ]
    },
    {
      header: "AoE Settings",
      options: [
        { uid: "DemoUseImplosion", text: "Use Implosion in AoE", type: "checkbox", default: true },
        { uid: "DemoImplThreshold", text: "Min targets for Implosion", type: "slider", min: 2, max: 8, default: 3 }
      ]
    },
    {
      header: "Talent Options",
      options: [
        { uid: "DemoHasSacrificedSouls", text: "Using Sacrificed Souls Talent", type: "checkbox", default: true },
        { uid: "DemoHasFelInvocation", text: "Using Fel Invocation Talent", type: "checkbox", default: false },
        { uid: "DemoHasGrimoireFelguard", text: "Using Grimoire Felguard Talent", type: "checkbox", default: true },
        { uid: "DemoHasSummonVilefiend", text: "Using Summon Vilefiend Talent", type: "checkbox", default: true }
      ]
    },
    {
      header: "Debug Options",
      options: [
        { uid: "DemoDebugMode", text: "Enable Debug Logging", type: "checkbox", default: false }
      ]
    }
  ];

  // State variables
  state = {
    firstTyrantTime: 12000,
    inOpener: true,
    nextTyrantCd: 0,
    impDespawn: 0,
    implFlag: false,
    poolCoresForTyrant: false,
    diabolicRitualRemains: 0,
    dreadstalkerSummonTime: 0,
    lastGcdSpell: '',
    variablesInitialized: false
  };

  // Pet tracking
  pets = {
    dreadstalkers: { count: 0, expirationTime: 0 },
    wildImps: { count: 0, spawnTimes: [] },
    vilefiend: { active: false, expirationTime: 0 },
    grimoireFelguard: { active: false, expirationTime: 0 }
  };

  // Debug logging
  log(message) {
    if (Settings.DemoDebugMode) {
      console.info(`[Demo Debug] ${message}`);
    }
  }

  build() {
    return new bt.Selector(
      // Combat prerequisites
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      new bt.Action(() => (this.getCurrentTarget() === null ? bt.Status.Success : bt.Status.Failure)),
      common.waitForTarget(),
      common.waitForFacing(),
      common.waitForCastOrChannel(),
      
      // Main rotation logic
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Calculate variables first
          this.calculateVariables(),
          
          // Potion usage
          new bt.Action(() => {
            if (Settings.DemoUsePotion && this.getAuraRemaining(auras.tyrant) > 10000) {
              this.log("Would use potion here (simulated)");
              return bt.Status.Success;
            }
            return bt.Status.Failure;
          }),
          
          // Call racials
          this.useRacials(),
          
          // Use trinkets
          // this.useTrinkets(),
          
          // Fight end sequence (under 30 seconds remaining)
          new bt.Decorator(
            req => this.getFightRemaining() < 30000,
            this.fightEndActions(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Opener sequence
          new bt.Decorator(
            req => CombatTimer.getCombatTime() < this.state.firstTyrantTime && this.state.inOpener,
            this.openerActions(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Tyrant setup sequence
          new bt.Decorator(
            req => spell.getCooldown(spells.summonDemonicTyrant).timeleft < this.getGcdMax() * 14,
            this.tyrantActions(),
            new bt.Action(() => bt.Status.Success)
          ),
          
          // Regular rotation
          this.singleTargetActions(),
          
          // Default actions
          spell.cast(spells.shadowBolt, this.getCurrentTarget),
          spell.cast(spells.infernalBolt, this.getCurrentTarget),
          spell.cast('Auto Attack', this.getCurrentTarget)
        )
      )
    );
  }

  // Initialize and update state variables
  calculateVariables() {
    return new bt.Action(() => {
      // Initialize variables if not done yet
      if (!this.state.variablesInitialized) {
        this.state.firstTyrantTime = 12000;
        
        // Add execution time for talents
        if (Settings.DemoHasGrimoireFelguard) {
          const grimoireSpell = spell.getSpell(spells.grimoireFelguard);
          this.state.firstTyrantTime += grimoireSpell ? grimoireSpell.castTime : 1500;
        }
        
        if (Settings.DemoHasSummonVilefiend) {
          const vilefiendSpell = spell.getSpell(spells.summonVilefiend);
          this.state.firstTyrantTime += vilefiendSpell ? vilefiendSpell.castTime : 2000;
        }
        
        // Add GCD if either talent is present
        if (Settings.DemoHasGrimoireFelguard || Settings.DemoHasSummonVilefiend) {
          this.state.firstTyrantTime += this.getGcdMax();
        }
        
        // Subtract Tyrant and Shadow Bolt cast times
        const tyrantSpell = spell.getSpell(spells.summonDemonicTyrant);
        const shadowBoltSpell = spell.getSpell(spells.shadowBolt);
        this.state.firstTyrantTime -= ((tyrantSpell ? tyrantSpell.castTime : 2000) + 
                                      (shadowBoltSpell ? shadowBoltSpell.castTime : 2000));
        
        // Ensure minimum of 10s
        this.state.firstTyrantTime = Math.max(10000, this.state.firstTyrantTime);
        
        this.state.inOpener = true;
        this.state.variablesInitialized = true;
        this.log(`First tyrant time set to ${this.state.firstTyrantTime}ms`);
      }
      
      // Update next tyrant cooldown
      this.state.nextTyrantCd = spell.getCooldown(spells.summonDemonicTyrant).timeleft;
      
      // If Tyrant was summoned, exit opener mode
      if ((me.hasAura(auras.tyrant)) || 
          (this.state.nextTyrantCd > 0 && this.state.nextTyrantCd < 120000 && this.state.inOpener)) {
        if (this.state.inOpener) {
          this.log("Tyrant detected - turning off opener mode");
          this.state.inOpener = false;
        }
      }
      
      // Update pet tracking
      this.updatePetTracking();
      
      // Update imp despawn logic
      if (this.wasPrevGcd(spells.handOfGuldan) && 
          this.hasDreadstalkers() && 
          this.state.nextTyrantCd < 13000 && 
          this.state.impDespawn === 0) {
        this.state.impDespawn = (2 * this.getSpellHaste() * 6 + 0.58) * 1000 + CombatTimer.getCombatTime();
        this.log(`Setting imp despawn to ${this.state.impDespawn}ms`);
      }
      
      // Check for dreadstalkers
      if (this.state.impDespawn) {
        this.state.impDespawn = Math.max(
          this.state.impDespawn, 
          this.getDreadstalkerRemaining() + CombatTimer.getCombatTime()
        );
      }
      
      // Check for grimoire felguard
      if (this.state.impDespawn && me.hasAura(auras.grimFelguard)) {
        this.state.impDespawn = Math.max(
          this.state.impDespawn, 
          this.getAuraRemaining(auras.grimFelguard) + CombatTimer.getCombatTime()
        );
      }
      
      // Reset impDespawn if Tyrant is active
      if (me.hasAura(auras.tyrant)) {
        this.state.impDespawn = 0;
      }
      
      // Define impl flag for Implosion usage
      const activeEnemies = this.getActiveEnemies();
      const sacrificedSoulsModifier = Settings.DemoHasSacrificedSouls ? 1 : 0;
      
      // Start with implFlag as false - this is the default and safe option
      this.state.implFlag = false;
      
      // Only set implFlag to true when we have more than 1 ACTUAL target
      // This ensures we never Implosion in pure single-target
      if (activeEnemies > 1) {
        // Base case - use Implosion when Tyrant is not active
        if (activeEnemies > 1 + sacrificedSoulsModifier) {
          this.state.implFlag = !me.hasAura(auras.tyrant);
        }
        
        // Medium AoE - only Implosion late in Tyrant
        if (activeEnemies > 2 + sacrificedSoulsModifier && activeEnemies < 5 + sacrificedSoulsModifier) {
          this.state.implFlag = this.getAuraRemaining(auras.tyrant) < 6000;
        }
        
        // Large AoE - Implosion earlier in Tyrant
        if (activeEnemies > 4 + sacrificedSoulsModifier) {
          this.state.implFlag = this.getAuraRemaining(auras.tyrant) < 8000;
        }
        
        // this.log(`Implosion flag set to ${this.state.implFlag} with ${activeEnemies} enemies`);
      }

      
      // Pool cores for tyrant logic
      this.state.poolCoresForTyrant = 
        this.state.nextTyrantCd < 20000 && 
        (me.hasAura(auras.demonicCore) || !me.hasAura(auras.demonicCore)) &&
        spell.getCooldown(spells.summonVilefiend).timeleft < this.getGcdMax() * 8 &&
        spell.getCooldown(spells.callDreadstalkers).timeleft < this.getGcdMax() * 8;
      
      // Set diabolic ritual remains
      if (me.hasAura(auras.diabolicsRitualMother)) {
        this.state.diabolicRitualRemains = this.getAuraRemaining(auras.diabolicsRitualMother);
      } else if (me.hasAura(auras.diabolicsRitualOverlord)) {
        this.state.diabolicRitualRemains = this.getAuraRemaining(auras.diabolicsRitualOverlord);
      } else if (me.hasAura(auras.diabolicsRitualPitLord)) {
        this.state.diabolicRitualRemains = this.getAuraRemaining(auras.diabolicsRitualPitLord);
      } else {
        this.state.diabolicRitualRemains = 0;
      }
      
      if (Settings.DemoDebugMode) {
        this.logState();
      }
      
      return bt.Status.Failure; // Continue with next action
    });
  }

  // Helper method to update pet tracking information
  // Fixes to Dreadstalkers tracking

// In the updatePetTracking method
updatePetTracking() {
  try {
    // Update dreadstalker tracking
    const dreadstalkerAura = me.getAura(auras.dreadstalkers);
    
    if (dreadstalkerAura) {
      this.pets.dreadstalkers.count = 2; // Always 2 when summoned
      this.pets.dreadstalkers.expirationTime = CombatTimer.getCombatTime() + dreadstalkerAura.remaining;
      this.log(`Dreadstalkers detected from aura, remaining: ${dreadstalkerAura.remaining}ms`);
    } else {
      // Check for actual dreadstalker units in the world if the aura isn't found
      let dreadstalkerCount = 0;
      objMgr.objects.forEach(obj => {
        if (obj instanceof wow.CGUnit && 
            obj.createdBy && 
            me.guid && 
            obj.createdBy.equals(me.guid) && 
            obj.name === 'Dreadstalker') {
          dreadstalkerCount++;
        }
      });
      
      if (dreadstalkerCount > 0) {
        this.pets.dreadstalkers.count = dreadstalkerCount;
        
        // If we detected dreadstalkers but don't have an expiration time set, use the timestamp-based tracking
        if (this.pets.dreadstalkers.expirationTime === 0 && this.state.dreadstalkerSummonTime > 0) {
          this.pets.dreadstalkers.expirationTime = this.state.dreadstalkerSummonTime + 12000;
          this.log(`Using timestamp-based tracking for dreadstalkers`);
        }
      } else if (CombatTimer.getCombatTime() < this.pets.dreadstalkers.expirationTime) {
        // We still think they're active based on our timer but didn't detect them - keep the count
        this.pets.dreadstalkers.count = 2;
        this.log(`Dreadstalkers assumed active from timestamp`);
      } else {
        // Reset if our timer expired and we didn't find any dreadstalkers
        this.pets.dreadstalkers.count = 0;
        this.pets.dreadstalkers.expirationTime = 0;
      }
    }
    
    // Rest of pet tracking code...
  } catch (e) {
    console.error(`Error in updatePetTracking: ${e.message}`);
  }
}

  // Helper to get current target
  getCurrentTarget() {
    const targetPredicate = unit => unit && !unit.deadOrGhost && me.isFacing(unit);
    const target = me.targetUnit;
    if (target && targetPredicate(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  // Single-target rotation
  singleTargetActions() {
    return new bt.Selector(
      // Call Dreadstalkers when not in tyrant setup
      spell.cast(spells.callDreadstalkers, this.getCurrentTarget, req => {
        // Debug log the condition
        const tyrantCd = this.state.nextTyrantCd;
        this.log(`Regular Call Dreadstalkers check - Tyrant CD: ${tyrantCd}ms, Should cast: ${tyrantCd > 25000}`);
        
        // Only cast if tyrant CD is more than 25 seconds
        return tyrantCd > 25000;
      }, success => {
        this.trackDreadstalkerSummon();
        this.log("Call Dreadstalkers was cast successfully!");
        return true;
      }),
      
      // Summon Vilefiend when not in tyrant setup
      spell.cast(spells.summonVilefiend, this.getCurrentTarget, req => 
        spell.getCooldown(spells.summonDemonicTyrant).timeleft > 30000 && 
        Settings.DemoHasSummonVilefiend
      ),
      
      // Demonbolt with Demonic Core outside of tyrant setup
      spell.cast(spells.demonbolt, this.getCurrentTarget, req => {
        const target = this.getCurrentTarget();
        return me.hasAura(auras.demonicCore) &&
          (!this.hasTalent('Doom') || 
           me.hasAura(auras.demonicCore) || 
           !target || 
           this.getTargetDebuffRemaining(target, debuffs.doom) > 10000 || 
           !target.hasAura(debuffs.doom)) &&
          (((!this.hasTalent('Fel Invocation') || 
             this.getSoulStrikeCD() > this.getGcdMax() * 2) && 
            this.getSoulShards() < 4)) &&
          !this.wasPrevGcd(spells.demonbolt) &&
          !this.state.poolCoresForTyrant;
      }),
      
      // Pet attack command
      Pet.attack(this.getCurrentTarget),
      
      // Power Siphon outside tyrant setup
      spell.cast(spells.powerSiphon, req =>
        me.hasAura(auras.demonicCore) && 
        spell.getCooldown(spells.summonDemonicTyrant).timeleft > 25000
      ),
      
      // Demonic Strength for AoE
      spell.cast(spells.demonicStrength, this.getCurrentTarget, req =>
        this.getActiveEnemies() > 1
      ),
      
      // Hand of Gul'dan for single target
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req => {
        const soulShards = this.getSoulShards();
        const tyrantCD = spell.getCooldown(spells.summonDemonicTyrant).timeleft;
        const dreadstalkerCD = spell.getCooldown(spells.callDreadstalkers).timeleft;
        const demonicCallingRemain = this.getAuraRemaining(auras.demonicCalling);
        
        return ((soulShards > 2 &&
                (dreadstalkerCD > this.getGcdMax() * 4 ||
                 demonicCallingRemain - this.getGcdMax() > dreadstalkerCD) &&
                tyrantCD > 17000) ||
               soulShards === 5 ||
               (soulShards === 4 && this.hasTalent('Fel Invocation'))) &&
              (this.getActiveEnemies() === 1);
      }),
      
      // Hand of Gul'dan for AoE
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req =>
        this.getSoulShards() > 2 && this.getActiveEnemies() > 1
      ),
      
      // Implosion logic when enabled and in AoE
      spell.cast(spells.implosion, this.getCurrentTarget, req => {
        // Get current enemy count each time this is checked
        const currentEnemies = this.getActiveEnemies();
        
        // Extra safety check - never use in pure single target
        if (currentEnemies <= 1) {
          return false;
        }
        
        return Settings.DemoUseImplosion &&
          this.getTwoCastImps() > 0 && 
          this.state.implFlag && 
          !this.wasPrevGcd(spells.implosion) &&
          currentEnemies >= Settings.DemoImplThreshold;
      }),
      
      // More Demonbolt conditions
      spell.cast(spells.demonbolt, this.getCurrentTarget, req => {
        const target = this.getCurrentTarget();
        return (!target || !target.hasAura(debuffs.doom) || this.getActiveEnemies() < 4) &&
               me.hasAura(auras.demonicCore) &&
               ((this.getSoulShards() < 4 && !this.hasTalent('Soul Strike') ||
                 (this.getSoulStrikeCD() > this.getGcdMax() * 2 && this.hasTalent('Fel Invocation'))) ||
                this.getSoulShards() < 3) &&
               !this.state.poolCoresForTyrant;
      }),
      
      spell.cast(spells.demonbolt, this.getCurrentTarget, req =>
        me.hasAura(auras.demonicCore) && me.hasAura(auras.tyrant) && this.getSoulShards() < 3
      ),
      
      spell.cast(spells.demonbolt, this.getCurrentTarget, req =>
        me.hasAura(auras.demonicCore) && this.getSoulShards() < 4
      ),
      
      // Fallback to Shadow Bolt
      spell.cast(spells.shadowBolt, this.getCurrentTarget)
    );
  }

  // Fight end sequence (when less than 30 seconds remain)
  fightEndActions() {
    return new bt.Selector(
      spell.cast(spells.grimoireFelguard, this.getCurrentTarget, req => 
        this.getFightRemaining() < 20000 && Settings.DemoHasGrimoireFelguard
      ),
      
      spell.cast(spells.ruination, this.getCurrentTarget),
      
      spell.cast(spells.implosion, this.getCurrentTarget, req => 
        this.getFightRemaining() < this.getGcdMax() * 2 * 1000 && 
        !this.wasPrevGcd(spells.implosion) &&
        Settings.DemoUseImplosion
      ),
      
      spell.cast(spells.demonbolt, this.getCurrentTarget, req => {
        const demonicCoreStacks = me.hasAura(auras.demonicCore) ? 1 : 0;
        return this.getFightRemaining() < this.getGcdMax() * 2 * demonicCoreStacks * 1000 + 9000 && 
               me.hasAura(auras.demonicCore) && 
               (this.getSoulShards() < 4 || 
                this.getFightRemaining() < demonicCoreStacks * this.getGcdMax() * 1000);
      }),
      
      spell.cast(spells.callDreadstalkers, this.getCurrentTarget, req => 
        this.getFightRemaining() < 20000
      , success => {
        this.trackDreadstalkerSummon();
        return true;
      }),
      
      spell.cast(spells.summonVilefiend, this.getCurrentTarget, req => 
        this.getFightRemaining() < 20000 && Settings.DemoHasSummonVilefiend
      ),
      
      spell.cast(spells.summonDemonicTyrant, this.getCurrentTarget, req => 
        this.getFightRemaining() < 20000
      ),
      
      spell.cast(spells.demonicStrength, this.getCurrentTarget, req => 
        this.getFightRemaining() < 10000
      ),
      
      spell.cast(spells.powerSiphon, req => 
        me.hasAura(auras.demonicCore) && this.getFightRemaining() < 20000
      ),
      
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req => 
        this.getSoulShards() > 2 && 
        this.getFightRemaining() < this.getGcdMax() * 2 * 
        (me.hasAura(auras.demonicCore) > 0 ? 1 : 0) * 1000 + 9000
      ),
      
      spell.cast(spells.infernalBolt, this.getCurrentTarget)
    );
  }
  
  // Opener sequence
  openerActions() {
    return new bt.Selector(
      spell.cast(spells.grimoireFelguard, this.getCurrentTarget, req => {
        const felInvocationAdjustment = this.hasTalent('Fel Invocation') ? 1 : 0;
        return this.getSoulShards() >= 5 - felInvocationAdjustment && 
               Settings.DemoHasGrimoireFelguard;
      }),
      
      spell.cast(spells.summonVilefiend, this.getCurrentTarget, req => 
        this.getSoulShards() === 5 && Settings.DemoHasSummonVilefiend
      ),
      
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => 
        this.getSoulShards() < 5 && 
        spell.getCooldown(spells.callDreadstalkers).timeleft === 0
      ),
      
      spell.cast(spells.callDreadstalkers, this.getCurrentTarget, req => 
        this.getSoulShards() === 5
      , success => {
        this.trackDreadstalkerSummon();
        return true;
      }),
      
      spell.cast(spells.ruination, this.getCurrentTarget)
    );
  }

  // Tyrant setup sequence
  tyrantActions() {
    return new bt.Selector(
      // Use racials if imp despawn conditions are met
      new bt.Decorator(
        req => {
          if (!this.state.impDespawn) return false;
          
          const currentTime = CombatTimer.getCombatTime();
          return this.state.impDespawn < currentTime + this.getGcdMax() * 2 * 1000 + 
                 this.getCastTime(spells.summonDemonicTyrant) &&
                 (this.wasPrevGcd(spells.handOfGuldan) || this.wasPrevGcd(spells.ruination)) &&
                 (this.state.impDespawn < currentTime + this.getGcdMax() * 1000 + 
                  this.getCastTime(spells.summonDemonicTyrant) || this.getSoulShards() < 2);
        },
        this.useRacials(),
        new bt.Action(() => bt.Status.Success)
      ),
      
      // Power Siphon for tyrant setup
      spell.cast(spells.powerSiphon, req => 
        spell.getCooldown(spells.summonDemonicTyrant).timeleft < 15000
      ),
      
      // Ruination with dreadstalkers active
      spell.cast(spells.ruination, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        const dreadstalkerTime = this.getDreadstalkerRemaining();
        const tyrantCastTime = this.getCastTime(spells.summonDemonicTyrant);
        
        return dreadstalkerTime > this.getGcdMax() * 1000 + tyrantCastTime &&
               (this.getSoulShards() === 5 || this.state.impDespawn);
      }),
      
      // Infernal Bolt for soul shards
      spell.cast(spells.infernalBolt, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        return !me.hasAura(auras.demonicCore) &&
               this.state.impDespawn > currentTime + this.getGcdMax() * 2 * 1000 + 
               this.getCastTime(spells.summonDemonicTyrant) &&
               this.getSoulShards() < 3;
      }),
      
      // Shadow Bolt after Call Dreadstalkers
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => 
        this.wasPrevGcd(spells.callDreadstalkers) && 
        this.getSoulShards() < 4 && 
        me.hasAura(auras.demonicCore)
      ),
      
      // Shadow Bolt with Bloodlust
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => 
        this.wasPrevGcd(2, spells.callDreadstalkers) && 
        this.wasPrevGcd(spells.shadowBolt) && 
        me.hasAura(auras.bloodlust) && 
        this.getSoulShards() < 5
      ),
      
      // Shadow Bolt after Summon Vilefiend
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => 
        this.wasPrevGcd(spells.summonVilefiend) && 
        (!me.hasAura(auras.demonicCalling) || this.wasPrevGcd(2, spells.grimoireFelguard))
      ),
      
      // Shadow Bolt after Grimoire Felguard
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => 
        this.wasPrevGcd(spells.grimoireFelguard) && 
        me.hasAura(auras.demonicCore) && 
        this.getAuraRemaining(auras.demonicCalling) > this.getGcdMax() * 3 * 1000
      ),
      
      // Hand of Gul'dan with Demonic Art Pit Lord
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        return this.state.impDespawn > currentTime + this.getGcdMax() * 2 * 1000 + 
               this.getCastTime(spells.summonDemonicTyrant) &&
               !me.hasAura(auras.demonicCore) && 
               me.hasAura('Demonic Art Pit Lord') && 
               this.state.impDespawn < currentTime + this.getGcdMax() * 5 * 1000 + 
               this.getCastTime(spells.summonDemonicTyrant);
      }),
      
      // Hand of Gul'dan timing with imps and dreadstalkers
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        const dreadstalkerTime = this.getDreadstalkerRemaining();
        const tyrantCastTime = this.getCastTime(spells.summonDemonicTyrant);
        
        return this.state.impDespawn > currentTime + this.getGcdMax() * 1000 + tyrantCastTime &&
               this.state.impDespawn < currentTime + this.getGcdMax() * 2 * 1000 + tyrantCastTime &&
               dreadstalkerTime > this.getGcdMax() * 1000 + tyrantCastTime &&
               this.getSoulShards() > 1;
      }),
      
      // Shadow Bolt timing with imps and dreadstalkers
      spell.cast(spells.shadowBolt, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        const dreadstalkerTime = this.getDreadstalkerRemaining();
        const tyrantCastTime = this.getCastTime(spells.summonDemonicTyrant);
        
        return !me.hasAura(auras.demonicCore) &&
               this.state.impDespawn > currentTime + this.getGcdMax() * 2 * 1000 + tyrantCastTime &&
               this.state.impDespawn < currentTime + this.getGcdMax() * 4 * 1000 + tyrantCastTime &&
               this.getSoulShards() < 3 &&
               dreadstalkerTime > this.getGcdMax() * 2 * 1000 + tyrantCastTime;
      }),
      
      // Grimoire Felguard timing for optimal setup
      spell.cast(spells.grimoireFelguard, this.getCurrentTarget, req => {
        if (!Settings.DemoHasGrimoireFelguard) return false;
        
        return spell.getCooldown(spells.summonDemonicTyrant).timeleft < 13000 + this.getGcdMax() && 
               spell.getCooldown(spells.summonVilefiend).timeleft < this.getGcdMax() && 
               spell.getCooldown(spells.callDreadstalkers).timeleft < this.getGcdMax() * 3.33 && 
               ((this.getSoulShards() === 5 - (this.getSoulStrikeCD() < this.getGcdMax() ? 1 : 0) && 
                 this.hasTalent('Fel Invocation')) || this.getSoulShards() === 5);
      }),
      
      // Summon Vilefiend timing
      spell.cast(spells.summonVilefiend, this.getCurrentTarget, req => {
        if (!Settings.DemoHasSummonVilefiend) return false;
        
        return (me.hasAura(auras.grimFelguard) || 
                spell.getCooldown(spells.grimoireFelguard).timeleft > 10000 || 
                !Settings.DemoHasGrimoireFelguard) && 
               spell.getCooldown(spells.summonDemonicTyrant).timeleft < 13000 && 
               spell.getCooldown(spells.callDreadstalkers).timeleft < this.getGcdMax() * 2.33 && 
               (this.getSoulShards() === 5 || 
                (this.getSoulShards() === 4 && me.hasAura(auras.demonicCore)) || 
                me.hasAura(auras.grimFelguard));
      }),
      
      // Call Dreadstalkers timing
      spell.cast(spells.callDreadstalkers, this.getCurrentTarget, req => {
        const vilefiendCheck = !Settings.DemoHasSummonVilefiend || me.hasAura(auras.vilefiend);
        const tyrantCd = spell.getCooldown(spells.summonDemonicTyrant).timeleft;
        const shardCheck = this.getSoulShards() >= 5 - (me.hasAura(auras.demonicCore) ? 1 : 0);
        const grimoireCheck = this.wasPrevGcd(3, spells.grimoireFelguard);
        
        this.log(`Tyrant Call Dreadstalkers check - Vilefiend: ${vilefiendCheck}, Tyrant CD: ${tyrantCd}ms, ` +
                 `Shards: ${this.getSoulShards()}, Need: ${5 - (me.hasAura(auras.demonicCore) ? 1 : 0)}, ` +
                 `Grimoire check: ${grimoireCheck}, Should cast: ${vilefiendCheck && tyrantCd < 10000 && (shardCheck || grimoireCheck)}`);
        
        return vilefiendCheck && 
               tyrantCd < 10000 && 
               (shardCheck || grimoireCheck);
      }, success => {
        this.trackDreadstalkerSummon();
        this.log("Tyrant setup Call Dreadstalkers was cast successfully!");
        return true;
      }),
      
      // Summon Demonic Tyrant when conditions are met
      spell.cast(spells.summonDemonicTyrant, this.getCurrentTarget, req => {
        const currentTime = CombatTimer.getCombatTime();
        const tyrantCastTime = this.getCastTime(spells.summonDemonicTyrant);
        const dreadstalkerTime = this.getDreadstalkerRemaining();
        
        return (this.state.impDespawn && 
                this.state.impDespawn < currentTime + this.getGcdMax() * 2 * 1000 + tyrantCastTime) || 
               (dreadstalkerTime < this.getGcdMax() * 2 * 1000 + tyrantCastTime && 
                dreadstalkerTime > 0);
      }),
      
      // Hand of Gul'dan for soul shard management
      spell.cast(spells.handOfGuldan, this.getCurrentTarget, req => 
        (this.state.impDespawn || this.getDreadstalkerRemaining() > 0) && 
        this.getSoulShards() >= 3 || this.getSoulShards() === 5
      ),
      
      // Infernal Bolt if imps are about to despawn and low on soul shards
      spell.cast(spells.infernalBolt, this.getCurrentTarget, req => 
        this.state.impDespawn && this.getSoulShards() < 3
      ),
      
      // Demonbolt with various conditions
      spell.cast(spells.demonbolt, this.getCurrentTarget, req => 
        (this.state.impDespawn && me.hasAura(auras.demonicCore) && this.getSoulShards() < 4) || 
        (this.wasPrevGcd(spells.callDreadstalkers) && this.getSoulShards() < 4 && me.hasAura(auras.demonicCore)) || 
        (me.hasAura(auras.demonicCore) && this.getSoulShards() < 4) || 
        (me.hasAura(auras.demonicCore) && spell.getCooldown(spells.powerSiphon).timeleft < 5000)
      ),
      
      // Ruination with imps about to despawn or at max soul shards
      spell.cast(spells.ruination, this.getCurrentTarget, req => 
        this.state.impDespawn || 
        (this.getSoulShards() === 5 && spell.getCooldown(spells.summonVilefiend).timeleft > this.getGcdMax() * 3)
      ),
      
      // Default to Shadow Bolt
      spell.cast(spells.shadowBolt, this.getCurrentTarget),
      
      // Fallback to Infernal Bolt
      spell.cast(spells.infernalBolt, this.getCurrentTarget)
    );
  }
  
  // Racial abilities use
  useRacials() {
    return new bt.Selector(
      spell.cast('Berserking', req => me.hasAura(auras.tyrant) || this.getFightRemaining() < 22000),
      spell.cast('Blood Fury', req => me.hasAura(auras.tyrant) || this.getFightRemaining() < 22000),
      spell.cast('Fireblood', req => me.hasAura(auras.tyrant) || this.getFightRemaining() < 22000),
      spell.cast('Ancestral Call', req => me.hasAura(auras.tyrant) || this.getFightRemaining() < 22000)
    );
  }
  
  // Trinket usage logic
  useTrinkets() {
    return new bt.Action(() => {
      if (!Settings.DemoUseTrinkets) {
        return bt.Status.Failure;
      }
      
      // This is a simplified trinket usage logic
      // In a real implementation, you'd have to handle different trinket types and cooldowns
      this.log("Would use trinkets here if implemented");
      return bt.Status.Failure;
    });
  }

  // Helper methods
  hasTalent(talentName) {
    if (talentName === 'Summon Vilefiend') {
      return Settings.DemoHasSummonVilefiend;
    } else if (talentName === 'Grimoire Felguard') {
      return Settings.DemoHasGrimoireFelguard;
    } else if (talentName === 'Fel Invocation') {
      return Settings.DemoHasFelInvocation;
    } else if (talentName === 'Sacrificed Souls') {
      return Settings.DemoHasSacrificedSouls;
    } else if (talentName === 'Doom') {
      // Check if player has Doom on spellbook
      return spell.isSpellKnown('Doom');
    } else if (talentName === 'Soul Strike') {
      return spell.isSpellKnown('Soul Strike');
    } else {
      // General check for talent by checking if spell is known
      return spell.isSpellKnown(talentName);
    }
  }
  
  // Updated trackDreadstalkerSummon method
trackDreadstalkerSummon() {
  const currentTime = CombatTimer.getCombatTime();
  this.state.dreadstalkerSummonTime = currentTime;
  this.pets.dreadstalkers.expirationTime = currentTime + 12000; // 12 seconds duration
  this.pets.dreadstalkers.count = 2; // Set count immediately
  this.log(`Dreadstalkers summoned at ${currentTime}ms, will expire at ${this.pets.dreadstalkers.expirationTime}ms`);
  
  // Also record this spell in our history
  spellHistory.recordSpell(spells.callDreadstalkers);
}

// Updated hasDreadstalkers method
hasDreadstalkers() {
  // First check the aura
  if (me.hasAura(auras.dreadstalkers)) {
    return true;
  }
  
  // Then check our pet tracking
  if (this.pets.dreadstalkers.count > 0) {
    return true;
  }
  
  // Finally check if we're still within the expected lifetime based on timestamp
  if (this.state.dreadstalkerSummonTime > 0) {
    const currentTime = CombatTimer.getCombatTime();
    const elapsed = currentTime - this.state.dreadstalkerSummonTime;
    if (elapsed < 12000) { // 12 second lifetime
      return true;
    }
  }
  
  return false;
}
  
  // Get remaining time for dreadstalkers in milliseconds
  getDreadstalkerRemaining() {
    // First try to get remaining from aura
    const dreadstalkerAura = me.getAura(auras.dreadstalkers);
    if (dreadstalkerAura) {
      return dreadstalkerAura.remaining;
    }
    
    // Then use our expiration time if set
    if (this.pets.dreadstalkers.expirationTime > 0) {
      const currentTime = CombatTimer.getCombatTime();
      const remaining = Math.max(0, this.pets.dreadstalkers.expirationTime - currentTime);
      return remaining;
    }
    
    // Finally use timestamp-based tracking as fallback
    if (this.state.dreadstalkerSummonTime > 0) {
      const currentTime = CombatTimer.getCombatTime();
      const elapsed = currentTime - this.state.dreadstalkerSummonTime;
      const remaining = Math.max(0, 12000 - elapsed); // 12 second lifetime
      return remaining;
    }
    
    return 0;
  }
  
  // Get remaining time for an aura in milliseconds
  getAuraRemaining(auraId) {
    const aura = me.getAura(auraId);
    return aura ? aura.remaining : 0;
  }
  
  // Get remaining time for a target's debuff in milliseconds
  getTargetDebuffRemaining(target, debuffId) {
    if (!target) return 0;
    
    const debuff = target.getAura(debuffId);
    return debuff ? debuff.remaining : 0;
  }
  
  // Get Soul Strike cooldown
  getSoulStrikeCD() {
    const soulStrikeSpell = wow.SpellBook.getSpellByName('Soul Strike');
    return soulStrikeSpell ? soulStrikeSpell.cooldown.timeleft : 0;
  }
  
  // Get number of soul shards
  getSoulShards() {
    return me.powerByType(PowerType.SoulShards);
  }
  
  // Get active enemies count
  getActiveEnemies(range = 10) {
    const targets = combat.targets.filter(unit => 
      unit.distanceTo(me) <= range && !unit.deadOrGhost && me.canAttack(unit)
    );
    return targets.length;
  }
  
  // Estimate fight remaining time
  getFightRemaining() {
    const target = this.getCurrentTarget();
    if (!target) return 300000; // Default to 5 minutes if no target
    
    const ttd = target.timeToDeath ? target.timeToDeath() : 300000;
    return ttd !== undefined ? ttd : 300000;
  }
  
  // Get GCD duration in milliseconds
  getGcdMax() {
    // Base GCD is 1.5s, affected by haste
    return 1500 / (1 + (me.modSpellHaste / 100));
  }
  
  // Get spell haste as a multiplier
  getSpellHaste() {
    return 1 + (me.modSpellHaste / 100);
  }
  
  // Get cast time for a spell in milliseconds
  getCastTime(spellName) {
    const spellObj = spell.getSpell(spellName);
    return spellObj ? spellObj.castTime : 1500; // Default to 1.5s if not found
  }
  
  // Check if a spell was used in the previous GCD
  wasPrevGcd(spellName, position = 1) {
    return spellHistory.wasPrevGcd(spellName, position);
  }
  
  // Get estimated number of wild imps that have existed for at least 2 GCDs
  getTwoCastImps() {
    // Count imps based on tracking in the object manager
    let impCount = 0;
    objMgr.objects.forEach(obj => {
      if (obj instanceof wow.CGUnit && 
          obj.createdBy && 
          me.guid && 
          obj.createdBy.equals(me.guid) && 
          obj.name === 'Wild Imp') {
        impCount++;
      }
    });
    
    // Alternatively, we could use a more sophisticated tracking system
    // that records imp spawn times and calculates their age
    return impCount;
  }
  
  // Get number of imps from the most recent cast
  getLastCastImps() {
    // Simple implementation - if the last spell was Hand of Gul'dan, estimate 3 imps
    if (this.wasPrevGcd(spells.handOfGuldan)) {
      return 3;
    }
    return 0;
  }
  
  // Log the current state for debugging
  logState() {
    this.log(`======= Demonology State =======`);
    this.log(`Time in combat: ${CombatTimer.getCombatTime()}ms`);
    this.log(`Soul Shards: ${this.getSoulShards()}`);
    this.log(`Active imps: ${this.pets.wildImps.count}`);
    this.log(`Dreadstalkers: ${this.hasDreadstalkers() ? 'Active' : 'Inactive'}, Remaining: ${this.getDreadstalkerRemaining()}ms`);
    this.log(`Demonic Core stacks: ${me.hasAura(auras.demonicCore) ? me.getAura(auras.demonicCore).stacks || 1 : 0}`);
    this.log(`Tyrant cooldown: ${this.state.nextTyrantCd}ms`);
    this.log(`Imp despawn time: ${this.state.impDespawn}ms`);
    this.log(`In opener: ${this.state.inOpener}`);
    this.log(`Pool cores for tyrant: ${this.state.poolCoresForTyrant}`);
    this.log(`===============================`);
  }
}

