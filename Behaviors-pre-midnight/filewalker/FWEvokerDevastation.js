import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import EvokerCommon from "@/Behaviors/EvokerCommon";
import { defaultCombatTargeting as Combat, defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { PowerType } from "@/Enums/PowerType";
import Specialization from "@/Enums/Specialization";

// Aura IDs based on latest data
const auras = {
  dragonRage: 375087,
  essenceBurst: 359618,
  burnout: 375802,
  massDisintegrate: 436336,
  leapingFlames: 370901,
  iridescenceBlue: 386399,
  iridescenceRed: 386283,
  shatteringStar: 370452,
  tipTheScales: 370553,
  snapfire: 370783,
  ancientFlame: 369458,
  scarletAdaptation: 372469,
  immediatDestruction: 370455,
  jackpot: 417910, // TWW2 4pc bonus
  bombardments: 386288,
  maneuverability: 370665,
  meltArmor: 370452,
  feed_the_flames: 369439,
  enkindle: 370842,
  volatility: 369089,
  imminentDestruction: 370621,
  power_swell: 376788,
  font_of_magic: 375783,
  arcane_vigor: 386342,
  eternitys_span: 375534,
  animosity: 375797,
  engulf: 357212,
  engulfing_blaze: 370837,
  ruby_embers: 365937,
  charged_blast: 370455,
  raging_inferno: 369846, // in_firestorm debuff
  scorching_embers: 370454,
  emerald_trance: 382778,
  mass_disintegrate_stacks: 383823,
  hover: 358267,
  blessing_of_the_bronze: 381748
};

// Additional spell IDs that might be needed
const spells = {
  dragonrage: 375087,
  fire_breath: 357208,
  eternity_surge: 359073,
  living_flame: 361469,
  azure_strike: 362969,
  shattering_star: 370452,
  disintegrate: 356995,
  deep_breath: 357210,
  tip_the_scales: 370553,
  hover: 358267,
  pyre: 357211,
  firestorm: 368847,
  engulf: 357212,
  emerald_blossom: 359816,
  verdant_embrace: 360995,
  renewing_blaze: 374348,
  obsidian_scales: 363916,
  quell: 351338
};

export class EvokerDevastationBehavior extends Behavior {
  name = "FW Devastation Evoker 2";
  context = BehaviorContext.Any;
  specialization = Specialization.Evoker.Devastation;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "Defensives",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseRenewingBlaze", text: "Use Renewing Blaze", default: true },
        { type: "checkbox", uid: "EvokerDevastationUseObsidianScales", text: "Use Obsidian Scales", default: true },
      ]
    },
    {
      header: "Damage",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseDeepBreath", text: "Use Deep Breath", default: true },
        { type: "slider", uid: "EvokerDevastationDeepBreathMinTargets", text: "Deep Breath Minimum Targets", min: 1, max: 10, default: 3 },
        { type: "checkbox", uid: "EvokerDevastationEnableBurst", text: "Enable Burst Mode", default: true },
        { type: "checkbox", uid: "EvokerDevastationUseFirestorm", text: "Use Firestorm", default: true },
        { type: "checkbox", uid: "EvokerDevastationUseEngulf", text: "Use Engulf", default: true },
      ]
    },
    {
      header: "Set Bonuses",
      options: [
        { type: "checkbox", uid: "EvokerDevastation4PreviousSet", text: "Use Last Tier (TWW S1) 4 Set Bonuses", default: true },
        { type: "checkbox", uid: "EvokerDevastation4Set", text: "Use 4 Set Bonuses", default: true },
      ]
    },
    {
      header: "Advanced Settings",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseHover", text: "Use Hover for Movement", default: true },
        { type: "checkbox", uid: "EvokerDevastationEarlyChainDisintegrate", text: "Early Chain Disintegrate", default: true },
        { type: "checkbox", uid: "EvokerDevastationClipDisintegrate", text: "Clip Disintegrate During Dragonrage", default: true },
        { type: "checkbox", uid: "EvokerDevastationPoolResourcesForDR", text: "Pool Resources Before Dragonrage", default: true },
        { type: "slider", uid: "EvokerDevastationDRPrepTimeAOE", text: "AoE Dragonrage Prep Time (seconds)", min: 1, max: 10, default: 4 },
        { type: "slider", uid: "EvokerDevastationDRPrepTimeST", text: "ST Dragonrage Prep Time (seconds)", min: 1, max: 15, default: 8 },
        { type: "slider", uid: "EvokerDevastationESSendThreshold", text: "ES Send Threshold", min: 1, max: 20, default: 8 },
      ]
    },
    {
      header: "Trinkets",
      options: [
        { type: "checkbox", uid: "EvokerDevastationUseTrinkets", text: "Use Trinkets", default: true },
        { type: "checkbox", uid: "EvokerDevastationAlignTrinkets", text: "Align Trinkets with Dragonrage", default: true },
      ]
    }
  ];
  
  build() {
    
    if (!this._variables) {
      this.initializeVariables();
    }
    
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      new bt.Action(() => EvokerCommon.handleEmpoweredSpell()),
      spell.cast("Blessing of the Bronze", on => me,
        req => !me.hasAura(auras.blessing_of_the_bronze)
      ),
      common.waitForCastOrChannel(),
      // Update variable states before decision making
      this.updateVariables(),
      this.defensives(),
      spell.interrupt("Quell"),
      common.waitForTarget(),
      common.waitForFacing(),
      this.hover(),
      // Call trinket action list first as per APL
      //this.trinkets(),
      new bt.Decorator(
        ret => combat.targets.length >= 3,
        this.aoeRotation()
      ),
      new bt.Decorator(
        ret => combat.targets.length <= 3,
        this.singleTargetRotation()
      ),
      this.singleTargetRotation()
    );
  }

  updateVariables() {
    
      // Calculate next dragonrage timing (in ms)
      const drRemains = spell.getCooldown("Dragonrage").timeleft;
      const fbRemains = Math.max(0, spell.getCooldown("Fire Breath").timeleft - 8000);
      const esRemains = Math.max(0, spell.getCooldown("Eternity Surge").timeleft - 8000);
      this.setVariable("next_dragonrage", Math.min(drRemains, Math.max(fbRemains, esRemains)));

      // Update can_extend_dr variable for Animosity talent
      if (me.hasAura("Animosity") && me.hasAura(auras.dragonRage)) {
        const drRemaining = this.getAuraRemainingTime(auras.dragonRage);
        // Check if we can still extend dragonrage
        this.setVariable("can_extend_dr", drRemaining > 0);
      } else {
        this.setVariable("can_extend_dr", false);
      }

      // Update pool_for_id for Imminent Destruction
      if (me.hasAura("Imminent Destruction")) {
        const dbRemains = spell.getCooldown("Deep Breath").timeleft;
        const shouldPool = dbRemains < 7000 && 
                          this.getEssenceDeficit() >= 1 && 
                          !me.hasAura(auras.essenceBurst) && 
                          (combat.targets.length >= 3 || (me.hasAura(auras.meltArmor) && me.hasAura(auras.maneuverability)));
        this.setVariable("pool_for_id", shouldPool);
      }

      return bt.Status.Success;
    
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Renewing Blaze", on => me,
        req => Settings.EvokerDevastationUseRenewingBlaze && 
              (me.pctHealth < 50 || combat.targets.length > 2)
      ),
      spell.cast("Obsidian Scales", on => me,
        req => Settings.EvokerDevastationUseObsidianScales && 
              (me.pctHealth < 40 || combat.targets.length > 3) && 
              !me.hasAura("Renewing Blaze")
      )
    );
  }

  hover() {
    return new bt.Selector(
      spell.cast("Hover", on => me,
        req => Settings.EvokerDevastationUseHover && 
              !me.hasAura(auras.hover) && 
              (me.hasAura(auras.massDisintegrate) || combat.targets.length <= 4)
      )
    );
  }

  trinkets() {
    if (!Settings.EvokerDevastationUseTrinkets) {
      return new bt.Action(() => bt.Status.Failure);
    }
    
    return new bt.Selector(
      // // Use trinket slot 1 with Dragonrage
      // spell.useItem("Trinket1",
      //   req => Settings.EvokerDevastationAlignTrinkets && 
      //         me.hasAura(auras.dragonRage) && 
      //         Combat.burstToggle && 
      //         !spell.getCooldown("Fire Breath").timeleft && 
      //         !spell.getCooldown("Shattering Star").timeleft
      // ),
      
      // // Use trinket slot 2 with Dragonrage
      // spell.useItem("Trinket2",
      //   req => Settings.EvokerDevastationAlignTrinkets && 
      //         me.hasAura(auras.dragonRage) && 
      //         Combat.burstToggle && 
      //         !spell.getCooldown("Fire Breath").timeleft && 
      //         !spell.getCooldown("Shattering Star").timeleft
      // ),
      
      // // Use trinket slot 1 on cooldown if not aligning
      // spell.useItem("Trinket1",
      //   req => !Settings.EvokerDevastationAlignTrinkets || 
      //         (this.getVariable("next_dragonrage") > 20000 || 
      //         !me.hasAura("Dragonrage"))
      // ),
      
      // // Use trinket slot 2 on cooldown if not aligning
      // spell.useItem("Trinket2",
      //   req => !Settings.EvokerDevastationAlignTrinkets || 
      //         (this.getVariable("next_dragonrage") > 20000 || 
      //         !me.hasAura("Dragonrage"))
      // )
    );
  }

  singleTargetRotation() {
    const drPrepST = () => Settings.EvokerDevastationDRPrepTimeST * 1000;
    
    return new bt.Selector(
      // Use Kharnalex trinket (special handling)
      // spell.useItem("Kharnalex the First Light",
      //   req => !me.hasAura(auras.dragonRage) && 
      //         !me.target.hasAura("Shattering Star Debuff")
      // ),
      
      // Call Eternity Surge with specific conditions for Imminent Destruction
      this.callEternitySurge(
        req => spell.getCooldown("Dragonrage").timeleft <= 0 && 
              me.hasAura(auras.imminentDestruction) && 
              me.hasAura(auras.massDisintegrate)
      ),
      
      // Hover for movement
      spell.cast("Hover", on => me,
        req => Settings.EvokerDevastationUseHover && 
              !me.hasAura(auras.hover)
      ),
      
      // Tip the Scales optimally
      spell.cast("Tip the Scales", on => me,
        req => (!me.hasAura("Dragonrage") || me.hasAura(auras.dragonRage)) && 
              (spell.getCooldown("Fire Breath").timeleft <= spell.getCooldown("Eternity Surge").timeleft || 
              (spell.getCooldown("Eternity Surge").timeleft <= spell.getCooldown("Fire Breath").timeleft && 
              me.hasAura(auras.font_of_magic)) && !me.hasAura(auras.engulf))
      ),
      
      // Deep Breath with Maneuverability and Melt Armor
      spell.cast("Deep Breath", 
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => Settings.EvokerDevastationUseDeepBreath && 
              me.hasAura(auras.maneuverability) && 
              me.hasAura(auras.meltArmor)
      ),
      // Dragonrage with cooldown alignment
      spell.cast("Dragonrage", on => me.target,
        req => me.target && 
              Combat.burstToggle && 
              Settings.EvokerDevastationEnableBurst && 
              (spell.getCooldown("Fire Breath").timeleft < 4000 || 
              (spell.getCooldown("Eternity Surge").timeleft < 4000 && 
              (!me.hasAura(auras.massDisintegrate) || this.hasSetBonus(2, 4)))) &&
              ((spell.getCooldown("Fire Breath").timeleft < 8000 || !me.hasAura("Animosity")) && 
              (spell.getCooldown("Eternity Surge").timeleft < 8000 || 
              me.hasAura(auras.massDisintegrate) || 
              !me.hasAura("Animosity") || 
              this.hasSetBonus(2, 4))) && 
              (me.target.timeToDie >= 32000 || me.target.timeToDie < 32000)
      ),
      
      // Call Eternity Surge for Dragonrage with specific conditions
      this.callEternitySurge(
        req => me.hasAura(auras.dragonRage) && 
              me.hasAura("Animosity") && 
              me.hasAura(auras.engulf) && 
              this.hasSetBonus(2, 4) && 
              !me.hasAura("Jackpot") && 
              this.hasVariable("can_extend_dr") && 
              !spell.getCooldown("Engulf").timeleft <= 0
      ),
      
      // Shattering Star without overcapping Essence Burst
      spell.cast("Shattering Star", on => me.target,
        req => me.target && (this.getEssenceBurstStacks() < this.getEssenceBurstMaxStacks() || 
              !me.hasAura(auras.arcane_vigor))
      ),
      // Engulf with detailed conditions
      spell.cast("Engulf", on => me.target,
        req => Settings.EvokerDevastationUseEngulf && 
              me.target && 
              me.target.hasAura("Fire Breath Damage") && 
              me.target.getDotRemaining("Fire Breath Damage") >= spell.travelTime("Engulf") + 
              spell.isInFlightTo("Engulf", me.target) * 1.5 && 
              (!me.hasAura("Enkindle") || me.target.hasAura("Enkindle")) && 
              (!me.hasAura("Ruby Embers") || me.target.hasAura("Living Flame Damage")) && 
              // Star/Iridescence logic
              ((!me.hasAura("Shattering Star") && !me.hasAura("Iridescence")) || 
              (me.target.hasAura("Shattering Star Debuff") && 
              (!me.hasAura("Iridescence") || spell.fullRechargeTime("Engulf") <= 
              spell.getCooldown("Fire Breath").timeleft + 4000 || me.hasAura(auras.dragonRage))) || 
              // Red Iridescence logic
              (me.hasAura(auras.iridescenceRed) && 
              (me.target.hasAura("Shattering Star Debuff") || 
              !me.hasAura("Shattering Star") || 
              spell.fullRechargeTime("Engulf") <= spell.getCooldown("Shattering Star").timeleft)) || 
              // Scorching embers logic
              (me.hasAura("Scorching Embers") && 
              me.target.getDotDuration("Fire Breath Damage") <= 10000 && 
              me.target.getDotRemaining("Fire Breath Damage") <= 5000)) && 
              // Dragonrage timing logic
              (this.getVariable("next_dragonrage") >= spell.cooldown("Engulf") * 1.2 || 
              !me.hasAura("Dragonrage") || 
              spell.fullRechargeTime("Engulf") <= this.getVariable("next_dragonrage")) && 
              // Tip the Scales logic
              (spell.getCooldown("Tip the Scales").timeleft >= 4000 || 
              spell.getCooldown("Fire Breath").timeleft >= 8000 || 
              !me.hasAura("Scorching Embers") || 
              !me.hasAura("Tip the Scales")) && 
              // Iridescence timing logic
              (!me.hasAura("Iridescence") || 
              me.hasAura(auras.iridescenceRed) && 
              (me.target.getDotRemaining("Shattering Star Debuff") >= spell.travelTime("Engulf") || 
              spell.getCooldown("Shattering Star").timeleft + spell.getGCD() > this.getAuraRemainingTime(auras.iridescenceRed) || 
              this.getEssence() < 3 && this.getAuraStacks(auras.iridescenceRed) == 1 || 
              spell.fullRechargeTime("Engulf") < spell.getCooldown("Fire Breath").timeleft && 
              (me.target.getDotRemaining("Shattering Star Debuff") >= spell.travelTime("Engulf")) || 
              !me.hasAura("Shattering Star"))) || 
              me.target.timeToDie <= 10000
      ),
      // Fire Breath logic with appropriate conditions
      this.callFireBreath(
        req => (!me.hasAura("Dragonrage") || this.getVariable("next_dragonrage") > drPrepST() || 
              !me.hasAura("Animosity")) && 
              (!spell.getCooldown("Eternity Surge").timeleft <= 0 || 
              !me.hasAura("Event Horizon") || me.hasAura(auras.massDisintegrate) || 
              !me.hasAura(auras.dragonRage) || (me.hasAura("Flame Siphon") && me.hasAura("Causality")) || 
              this.hasSetBonus(2, 4)) && 
              (me.target.timeToDie >= 8000 || !me.hasAura(auras.massDisintegrate)) && 
              ((me.target.hasAura("Shattering Star Debuff") || 
              !spell.getCooldown("Shattering Star").timeleft <= 0) && 
              me.hasAura(auras.dragonRage) && me.hasAura(auras.tipTheScales) || 
              !me.hasAura(auras.tipTheScales) || !me.hasAura("Dragonrage") || 
              !me.hasAura("Animosity") || !me.hasAura(auras.dragonRage) || !me.hasAura(auras.engulf))
      ),
      
      // Deep Breath with Imminent Destruction or Melt Armor
      spell.cast("Deep Breath", 
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => Settings.EvokerDevastationUseDeepBreath && 
               (me.hasAura(auras.imminentDestruction) && !me.target.hasAura("Shattering Star Debuff") || 
                me.hasAura(auras.meltArmor) && me.hasAura(auras.maneuverability)) && 
               (me.hasAura(auras.meltArmor) && me.hasAura(auras.maneuverability) || !me.hasAura(auras.dragonRage))
      ),
      
      // Eternity Surge call with standard conditions
      this.callEternitySurge(
        req => (!me.hasAura("Dragonrage") || this.getVariable("next_dragonrage") > drPrepST() || 
                !me.hasAura("Animosity") || me.hasAura(auras.massDisintegrate)) && 
               (!this.hasSetBonus(2, 4) || !me.hasAura("Jackpot") || 
                Settings.EvokerDevastationESSendThreshold <= spell.getCooldown("Fire Breath").timeleft || 
                me.hasAura(auras.massDisintegrate)) && 
               (!me.hasAura("Power Swell") || this.getAuraRemainingTime("Power Swell") <= this.getGcdMax())
      ),

      // Wait logic for Fire Breath to extend Dragonrage
      new bt.Action(() => {
        if (this.hasVariable("can_extend_dr") && me.hasAura("Animosity") && me.hasAura(auras.dragonRage)) {
          const drRemaining = this.getAuraRemainingTime(auras.dragonRage);
          const fbRemaining = spell.getCooldown("Fire Breath").timeleft;
          const r1CastTime = 1.0 * (1 / (1 + me.modSpellHaste / 100)) * 1000;
          
          if (drRemaining < this.getGcdMax() + r1CastTime * (me.hasAura(auras.tipTheScales) ? 0 : 1) && 
              drRemaining - fbRemaining >= r1CastTime * (me.hasAura(auras.tipTheScales) ? 0 : 1)) {
            return bt.Status.Running; // Wait for Fire Breath
          }
        }
        return bt.Status.Failure;
      }),
      
      // Wait logic for Eternity Surge to extend Dragonrage
      new bt.Action(() => {
        if (this.hasVariable("can_extend_dr") && me.hasAura("Animosity") && me.hasAura(auras.dragonRage)) {
          const drRemaining = this.getAuraRemainingTime(auras.dragonRage);
          const esRemaining = spell.getCooldown("Eternity Surge").timeleft;
          const r1CastTime = 1.0 * (1 / (1 + me.modSpellHaste / 100)) * 1000;
          
          if (drRemaining < this.getGcdMax() + r1CastTime && 
              drRemaining - esRemaining > r1CastTime * (me.hasAura(auras.tipTheScales) ? 0 : 1)) {
            return bt.Status.Running; // Wait for Eternity Surge
          }
        }
        return bt.Status.Failure;
      }),
      
      // Living Flame to exit Dragonrage with full Essence Burst stacks
      spell.cast("Living Flame", on => me.target,
        req => me.target && me.hasAura(auras.dragonRage) && 
               this.getAuraRemainingTime(auras.dragonRage) < 
               (this.getEssenceBurstMaxStacks() - this.getEssenceBurstStacks()) * 
               this.getGcdMax() && me.hasAura(auras.burnout)
      ),
      
      // Azure Strike as alternative to exit Dragonrage with full Essence Burst stacks
      spell.cast("Azure Strike", on => me.target,
        req => me.target && me.hasAura(auras.dragonRage) && 
               this.getAuraRemainingTime(auras.dragonRage) < 
               (this.getEssenceBurstMaxStacks() - this.getEssenceBurstStacks()) * 
               this.getGcdMax()
      ),
      // Firestorm with Snapfire
      spell.cast("Firestorm", on => me.target,
        req => Settings.EvokerDevastationUseFirestorm && 
               me.target && me.hasAura(auras.snapfire)
      ),
      
      // Living Flame with Burnout/Leaping Flames
      spell.cast("Living Flame", on => me.target,
        req => me.target && 
               (me.hasAura(auras.burnout) || me.hasAura("Flame Siphon") && 
                spell.getCooldown("Fire Breath").timeleft <= this.getGcdMax() * 3) && 
               me.hasAura(auras.leapingFlames) && !me.hasAura(auras.essenceBurst) && 
               (this.getEssenceDeficit() >= 1 || spell.getCooldown("Fire Breath").timeleft <= this.getGcdMax() * 3)
      ),
      
      // Living Flame for Ruby Embers/Engulf upkeep
      spell.cast("Living Flame", on => me.target,
        req => me.target && me.hasAura("Ruby Embers") && me.hasAura(auras.engulf) && 
               (me.hasAura(auras.burnout) && me.target.getDotRemaining("Living Flame Damage") <= this.getGcdMax() * 3 || 
                me.target.getDotRemaining("Living Flame Damage") <= this.getGcdMax()) && 
               !spell.isInFlightTo("Living Flame", me.target) && 
               (spell.getCooldown("Engulf").timeleft <= 0 || spell.getRechargeTime("Engulf") < this.getGcdMax() * 3)
      ),
      
      // Pyre for Feed the Flames in Firestorm with 20 CB stacks in 2T+
      spell.cast("Pyre", on => me.target,
        req => me.target && me.target.hasAura("In Firestorm") && 
               me.hasAura("Feed the Flames") && this.getAuraStacks("Charged Blast") === 20 && 
               combat.targets.length >= 2
      ),
      // Another Eternity Surge check with different conditions
      this.callEternitySurge(
        req => (!me.hasAura("Dragonrage") || this.getVariable("next_dragonrage") > drPrepST() || 
                !me.hasAura("Animosity") || me.hasAura(auras.massDisintegrate)) && 
               (!this.hasSetBonus(2, 4) || !me.hasAura("Jackpot") || me.hasAura(auras.massDisintegrate))
      ),
      
      // Mass Disintegrate
      spell.cast("Disintegrate", on => me.target,
        req => me.target && me.hasAura("Mass Disintegrate Stacks") && 
               me.hasAura(auras.massDisintegrate) && !this.hasVariable("pool_for_id")
      ),
      
      // Deep Breath on 2T+ or with Imminent Destruction
      spell.cast("Deep Breath", 
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => Settings.EvokerDevastationUseDeepBreath && !me.hasAura(auras.dragonRage) && 
               (combat.targets.length >= 2 || me.hasAura(auras.imminentDestruction) && 
                !me.target.hasAura("Shattering Star Debuff") || me.hasAura(auras.meltArmor) || 
                me.hasAura(auras.maneuverability))
      ),
      
      // Pyre with variable conditions
      spell.cast("Pyre", on => me.target,
        req => me.target && (this.hasVariable("pyre_st") || combat.targets.length > 1 && 
                            me.hasAura(auras.snapfire)) && !this.hasVariable("pool_for_id")
      ),
      
      // Disintegrate with early chain/clip conditions
      spell.cast("Disintegrate", on => me.target,
        req => me.target && Settings.EvokerDevastationEarlyChainDisintegrate && 
               Settings.EvokerDevastationClipDisintegrate && 
               !this.hasVariable("pool_for_id") && !this.hasVariable("pool_for_cb") && 
               !this.hasVariable("pyre_st")
      ),
      
      // Firestorm on 2T+
      spell.cast("Firestorm", on => me.target,
        req => Settings.EvokerDevastationUseFirestorm && me.target && combat.targets.length > 1
      ),

      // Green spells for Ancient Flame
      this.callGreenSpells(
        req => me.hasAura("Ancient Flame") && !me.hasAura(auras.ancientFlame) && 
               !me.target.hasAura("Shattering Star Debuff") && me.hasAura(auras.scarletAdaptation) && 
               !me.hasAura(auras.dragonRage) && !me.hasAura(auras.burnout) && me.hasAura("Engulfing Blaze")
      ),
      
      // Living Flame outside Dragonrage or with specific buffs in Dragonrage
      spell.cast("Living Flame", on => me.target,
        req => me.target && 
               (!me.hasAura(auras.dragonRage) || 
                (this.getAuraRemainingTime(auras.iridescenceRed) > spell.executeTime("Living Flame") || 
                 !me.hasAura("Engulfing Blaze") || me.hasAura(auras.iridescenceBlue) || 
                 me.hasAura(auras.burnout) || me.hasAura(auras.leapingFlames) && 
                 spell.getCooldown("Fire Breath").timeleft <= 5000) && combat.targets.length === 1)
      ),
      
      // Azure Strike as fallback
      spell.cast("Azure Strike", on => me.target,
        req => me.target
      )
    );
  }

  aoeRotation() {
    const drPrepAOE = () => Settings.EvokerDevastationDRPrepTimeAOE * 1000;
    
    return new bt.Selector(
      // Shattering Star before Dragonrage (without Engulf)
      spell.cast("Shattering Star", on => me.target,
        req => me.target && 
               ((spell.getCooldown("Dragonrage").timeleft <= 0 && me.hasAura(auras.arcane_vigor)) || 
               (me.hasAura(auras.eternitys_span) && combat.targets.length <= 3)) && 
               !me.hasAura(auras.engulf)
      ),
      
      // Hover for movement in AoE
      spell.cast("Hover", on => me,
        req => Settings.EvokerDevastationUseHover && 
               !me.hasAura(auras.hover) && 
               (me.hasAura(auras.massDisintegrate) && me.hasAura("Mass Disintegrate") || 
                combat.targets.length <= 4)
      ),
      
      // Use Firestorm if Snapfire is up and no Feed the Flames
      spell.cast("Firestorm", on => me.target,
        req => Settings.EvokerDevastationUseFirestorm && 
               me.target && 
               me.hasAura(auras.snapfire) && 
               !me.hasAura("Feed the Flames")
      ),
      // Deep Breath before other cooldowns (per APL: BaumChange 1)
      spell.cast("Deep Breath", 
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => Settings.EvokerDevastationUseDeepBreath && 
               ((me.hasAura(auras.maneuverability) && 
                 me.hasAura(auras.meltArmor) && 
                 !spell.getCooldown("Fire Breath").timeleft <= 0 && 
                 !spell.getCooldown("Eternity Surge").timeleft <= 0) || 
                (me.hasAura("Feed the Flames") && 
                 me.hasAura(auras.engulf) && 
                 me.hasAura(auras.imminentDestruction)))
      ),
      
      // Firestorm with Feed the Flames talent (per APL: BaumChange #3)
      spell.cast("Firestorm", on => me.target,
        req => Settings.EvokerDevastationUseFirestorm && 
               me.target && 
               me.hasAura("Feed the Flames") && 
               (!me.hasAura(auras.engulf) || 
                spell.getCooldown("Engulf").timeleft > 4000 || 
                spell.charges("Engulf") === 0 || 
                (this.getVariable("next_dragonrage") <= spell.cooldown("Firestorm") * 1.2 || 
                 !me.hasAura("Dragonrage")))
      ),
      
      // Fire Breath to grab Iridescence Red before Dragonrage
      this.callFireBreath(
        req => me.hasAura("Dragonrage") && 
               spell.getCooldown("Dragonrage").timeleft <= 0 && 
               (me.hasAura("Iridescence") || me.hasAura("Scorching Embers")) && 
               !me.hasAura(auras.engulf)
      ),
      // Tip the Scales optimally for AoE
      spell.cast("Tip the Scales", on => me,
        req => (!me.hasAura("Dragonrage") || me.hasAura(auras.dragonRage)) && 
               (spell.getCooldown("Fire Breath").timeleft <= spell.getCooldown("Eternity Surge").timeleft || 
                (spell.getCooldown("Eternity Surge").timeleft <= spell.getCooldown("Fire Breath").timeleft && 
                 me.hasAura(auras.font_of_magic)) && !me.hasAura(auras.engulf))
      ),
      
      // Shattering Star before Dragonrage (with Engulf) - per APL: BaumChange 2
      spell.cast("Shattering Star", on => me.target,
        req => me.target && 
               ((spell.getCooldown("Dragonrage").timeleft <= 0 && me.hasAura(auras.arcane_vigor)) || 
                (me.hasAura(auras.eternitys_span) && combat.targets.length <= 3)) && 
               me.hasAura(auras.engulf)
      ),
      
      // Dragonrage in AoE
      spell.cast("Dragonrage", on => me.target,
        req => me.target && 
               Combat.burstToggle && 
               Settings.EvokerDevastationEnableBurst && 
               (me.target.timeToDie >= 32000 || 
                combat.targets.length >= 3 && me.target.timeToDie >= 15000)
      ),
      // Fire Breath in AoE
      this.callFireBreath(
        req => (!me.hasAura("Dragonrage") || me.hasAura(auras.dragonRage) || 
               spell.getCooldown("Dragonrage").timeleft > drPrepAOE() || 
               !me.hasAura("Animosity") || me.hasAura("Flame Siphon")) && 
              (me.target.timeToDie >= 8000 || me.hasAura(auras.massDisintegrate))
      ),
      
      // Eternity Surge in AoE
      this.callEternitySurge(
        req => (!me.hasAura("Dragonrage") || me.hasAura(auras.dragonRage) || 
               spell.getCooldown("Dragonrage").timeleft > drPrepAOE() || 
               !me.hasAura("Animosity")) && 
              (!me.hasAura("Jackpot") || !this.hasSetBonus(2, 4) || me.hasAura(auras.massDisintegrate))
      ),
      
      // Shattering Star without overcapping - per APL: BaumChange 3
      spell.cast("Shattering Star", on => me.target,
        req => me.target && 
               ((this.getEssenceBurstStacks() < this.getEssenceBurstMaxStacks() && 
                 me.hasAura(auras.arcane_vigor)) || 
                (me.hasAura(auras.eternitys_span) && 
                 combat.targets.length <= 3) || 
                (this.hasSetBonus(2, 4) && 
                 this.getAuraStacks("Jackpot") < 2)) && 
               (!me.hasAura(auras.engulf) || 
                spell.getCooldown("Engulf").timeleft < 4000 || 
                spell.charges("Engulf") > 0)
      ),
      // Engulf in AoE
      spell.cast("Engulf", on => me.target,
        req => Settings.EvokerDevastationUseEngulf && 
               me.target && 
               me.target.hasAura("Fire Breath Damage") && 
               me.target.getDotRemaining("Fire Breath Damage") >= 
               spell.travelTime("Engulf") + 1.5 * spell.isInFlightTo("Engulf", me.target) && 
               (this.getVariable("next_dragonrage") >= spell.cooldown("Engulf") * 1.2 || 
                !me.hasAura("Dragonrage"))
      ),
      
      // Pyre with Charged Blast
      spell.cast("Pyre", on => me.target,
        req => me.target && 
               this.getAuraStacks("Charged Blast") >= 12 && 
               (spell.getCooldown("Dragonrage").timeleft > this.getGcdMax() * 4 || 
                !me.hasAura("Dragonrage"))
      ),
      
      // Mass Disintegrate
      spell.cast("Disintegrate", on => me.target,
        req => me.target && 
               me.hasAura(auras.massDisintegrate) && 
               me.hasAura("Mass Disintegrate") && 
               (!this.hasVariable("pool_for_id") || 
                this.getAuraRemainingTime(auras.massDisintegrate) <= 
                this.getAuraStacks(auras.massDisintegrate) * (spell.getSpell("Disintegrate").castTime + 100))
      ),
      // Deep Breath with Imminent Destruction
      spell.cast("Deep Breath", 
        on => {
          const bestTarget = EvokerCommon.findBestDeepBreathTarget();
          return bestTarget.unit ? bestTarget.unit.position : null;
        },
        req => Settings.EvokerDevastationUseDeepBreath && 
               me.hasAura(auras.imminentDestruction) && 
               !me.hasAura(auras.essenceBurst)
      ),
      
      // Pyre AoE
      spell.cast("Pyre", on => me.target,
        req => me.target && 
               (combat.targets.length >= 4 - (me.hasAura(auras.immediatDestruction) ? 1 : 0) || 
                me.hasAura(auras.volatility) || 
                (me.hasAura("Scorching Embers") && 
                 this.getActiveDots("Fire Breath Damage") >= combat.targets.length * 0.75)) && 
               (spell.getCooldown("Dragonrage").timeleft > this.getGcdMax() * 4 || 
                !me.hasAura("Dragonrage") || 
                !me.hasAura("Charged Blast")) && 
               !this.hasVariable("pool_for_id") && 
               (!me.hasAura("Mass Disintegrate Stacks") || 
                this.getEssenceBurstStacks() == 2 || 
                (this.getEssenceBurstStacks() == 1 && this.getEssence() >= (3 - (me.hasAura(auras.imminentDestruction) ? 1 : 0))) || 
                this.getEssence() >= (5 - (me.hasAura(auras.imminentDestruction) ? 2 : 0)))
      ),
      // Living Flame with Leaping Flames
      spell.cast("Living Flame", on => me.target,
        req => me.target && 
               (!me.hasAura("Burnout") || 
                me.hasAura(auras.burnout) || 
                spell.getCooldown("Fire Breath").timeleft <= this.getGcdMax() * 5000 || 
                me.hasAura(auras.scarletAdaptation) || 
                me.hasAura(auras.ancientFlame)) && 
               me.hasAura(auras.leapingFlames) && 
               (!me.hasAura(auras.essenceBurst) && 
                this.getEssenceDeficit() > 1 || 
                spell.getCooldown("Fire Breath").timeleft <= this.getGcdMax() * 3000 && 
                this.getEssenceBurstStacks() < this.getEssenceBurstMaxStacks())
      ),
      
      // Disintegrate with early chain and clip functionality
      spell.cast("Disintegrate", on => me.target,
        req => me.target && 
               Settings.EvokerDevastationEarlyChainDisintegrate && 
               Settings.EvokerDevastationClipDisintegrate && 
               (combat.targets.length <= 4 || me.hasAura(auras.massDisintegrate))
      ),
      
      // Living Flame with Burnout and Snapfire
      spell.cast("Living Flame", on => me.target,
        req => me.target && 
               me.hasAura(auras.snapfire) && 
               me.hasAura(auras.burnout)
      ),
      // Firestorm
      spell.cast("Firestorm", on => me.target,
        req => Settings.EvokerDevastationUseFirestorm && 
               me.target
      ),
      
      // Living Flame with Snapfire
      spell.cast("Living Flame", on => me.target,
        req => me.target && 
               me.hasAura(auras.snapfire) && 
               !me.hasAura("Engulfing Blaze")
      ),
      
      // Ancient Flame through green spells
      this.callGreenSpells(
        req => me.hasAura("Ancient Flame") && 
               !me.hasAura(auras.ancientFlame) && 
               !me.hasAura(auras.dragonRage)
      ),
      
      // Azure Strike as fallback
      spell.cast("Azure Strike", on => me.target,
        req => me.target
      )
    );
  }

  // Helper methods for empower spells and variable handling
  
  // Methods for calling empower spells with context
  callFireBreath(conditions) {
    return new bt.Selector(
      // Fire Breath for Scorching Embers and Engulf
      EvokerCommon.castEmpowered("Fire Breath", 2, on => me.target, 
        req => me.target && 
               me.hasAura("Scorching Embers") && 
               (spell.getCooldown("Engulf").timeleft <= spell.getSpell("Fire Breath").castTime + 500 || 
                spell.getCooldown("Engulf").timeleft <= 0) && 
               me.hasAura(auras.engulf) && 
               conditions()
      ),
      
      EvokerCommon.castEmpowered("Fire Breath", 3, on => me.target, 
        req => me.target && 
               me.hasAura("Scorching Embers") && 
               (spell.getCooldown("Engulf").timeleft <= spell.getSpell("Fire Breath").castTime + 500 || 
                spell.getCooldown("Engulf").timeleft <= 0) && 
               me.hasAura(auras.engulf) && 
               (!me.hasAura(auras.font_of_magic) || me.target.timeToDie <= spell.getSpell("Fire Breath").castTime) && 
               conditions()
      ),
      EvokerCommon.castEmpowered("Fire Breath", 4, on => me.target, 
        req => me.target && 
               me.hasAura("Scorching Embers") && 
               (spell.getCooldown("Engulf").timeleft <= spell.getSpell("Fire Breath").castTime + 500 || 
                spell.getCooldown("Engulf").timeleft <= 0) && 
               me.hasAura(auras.engulf) && 
               me.hasAura(auras.font_of_magic) && 
               conditions()
      ),
      
      // Standard Fire Breath usage for different situations
      EvokerCommon.castEmpowered("Fire Breath", 1, on => me.target, 
        req => me.target && 
               ((this.getAuraRemainingTime(auras.dragonRage) < 1.75 * this.getSpellHaste() && 
                 this.getAuraRemainingTime(auras.dragonRage) >= 1 * this.getSpellHaste()) && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr") || 
                combat.targets.length === 1) && 
               me.target.timeToDie <= spell.getSpell("Fire Breath").castTime && 
               conditions()
      ),
      EvokerCommon.castEmpowered("Fire Breath", 2, on => me.target, 
        req => me.target && 
               ((this.getAuraRemainingTime(auras.dragonRage) < 2.5 * this.getSpellHaste() && 
                 this.getAuraRemainingTime(auras.dragonRage) >= 1.75 * this.getSpellHaste()) && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr") || 
                me.hasAura("Scorching Embers") || 
                combat.targets.length >= 2) && 
               me.target.timeToDie <= me.target.hasAura("Fire Breath").remaining && 
               conditions()
      ),
      
      EvokerCommon.castEmpowered("Fire Breath", 3, on => me.target, 
        req => me.target && 
               (!me.hasAura(auras.font_of_magic) || 
                (this.getAuraRemainingTime(auras.dragonRage) <= 3.25 * this.getSpellHaste() && 
                 this.getAuraRemainingTime(auras.dragonRage) >= 2.5 * this.getSpellHaste()) && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr") || 
                me.hasAura("Scorching Embers")) && 
               me.target.timeToDie <= me.target.hasAura("Fire Breath").remaining && 
               conditions()
      ),
      
      EvokerCommon.castEmpowered("Fire Breath", 4, on => me.target, 
        req => me.target && conditions()
      )
    );
  }

  callEternitySurge(conditions) {
    return new bt.Selector(
      // Eternity Surge with dynamic empower levels
      EvokerCommon.castEmpowered("Eternity Surge", 1, on => me.target, 
        req => me.target && 
               (combat.targets.length <= 1 + (me.hasAura(auras.eternitys_span) ? 1 : 0) || 
                (this.hasVariable("can_extend_dr") && 
                 me.hasAura("Animosity") || 
                 me.hasAura(auras.massDisintegrate)) && 
                combat.targets.length > (3 + (me.hasAura(auras.font_of_magic) ? 1 : 0) + 
                                         (me.hasAura(auras.eternitys_span) ? 4 : 0)) || 
                this.getAuraRemainingTime(auras.dragonRage) < 1.75 * this.getSpellHaste() && 
                this.getAuraRemainingTime(auras.dragonRage) >= 1 * this.getSpellHaste() && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr")) && 
                conditions()
      ),
      EvokerCommon.castEmpowered("Eternity Surge", 2, on => me.target, 
        req => me.target && 
               (combat.targets.length <= 2 + 2 * (me.hasAura(auras.eternitys_span) ? 1 : 0) || 
                this.getAuraRemainingTime(auras.dragonRage) < 2.5 * this.getSpellHaste() && 
                this.getAuraRemainingTime(auras.dragonRage) >= 1.75 * this.getSpellHaste() && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr")) && 
                conditions()
      ),
      
      EvokerCommon.castEmpowered("Eternity Surge", 3, on => me.target, 
        req => me.target && 
               (combat.targets.length <= 3 + 3 * (me.hasAura(auras.eternitys_span) ? 1 : 0) || 
                !me.hasAura(auras.font_of_magic) && me.hasAura(auras.massDisintegrate) || 
                this.getAuraRemainingTime(auras.dragonRage) <= 3.25 * this.getSpellHaste() && 
                this.getAuraRemainingTime(auras.dragonRage) >= 2.5 * this.getSpellHaste() && 
                me.hasAura("Animosity") && 
                this.hasVariable("can_extend_dr")) && 
                conditions()
      ),
      EvokerCommon.castEmpowered("Eternity Surge", 4, on => me.target, 
        req => me.target && 
               (me.hasAura(auras.massDisintegrate) || 
                combat.targets.length <= 4 + 4 * (me.hasAura(auras.eternitys_span) ? 1 : 0)) && 
                conditions()
      ),

      // Fallback for custom empower level based on target count
      EvokerCommon.castEmpowered("Eternity Surge", 
        () => {
          const targetCount = combat.targets.length;
          if (targetCount >= 7) return 4;
          if (targetCount >= 5) return 3;
          if (targetCount >= 3) return 2;
          return 1;
        }, 
        on => me.target, 
        req => me.target && combat.targets.length > 0 && conditions()
      )
    );
  }

  // Helper for calling green spells
  callGreenSpells(conditions) {
    return new bt.Selector(
      spell.cast("Emerald Blossom", on => me,
        req => conditions()
      ),
      spell.cast("Verdant Embrace", on => me,
        req => conditions()
      )
    );
  }

  // Helper functions for variable and state checks
  hasSetBonus(tier, pieces) {
    if (tier === 1 && pieces === 4) {
      // Check for previous tier (TWW S1) 4pc bonus
      return Settings.EvokerDevastation4PreviousSet;
    } else if (tier === 2 && pieces === 4) {
      // Check for current tier (TWW S2) 4pc bonus
      return Settings.EvokerDevastation4Set;
    }
    
    // Default to false for any other combinations
    return false;
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }
  
  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }

  getSpellHaste() {
    return (1 + me.modSpellHaste / 100);
  }

  getEssence() {
    return me.powerByType(PowerType.Essence);
  }
  
  getEssenceDeficit() {
    return me.powerByType(PowerType.Essence, true);
  }
  
  getEssenceBurstStacks() {
    return this.getAuraStacks(auras.essenceBurst);
  }
  
  getEssenceBurstMaxStacks() {
    const aura = me.getAura(auras.essenceBurst);
    return aura ? aura.maxStacks : 2; // Default to 2 if aura not found
  }
  
  getActiveDots(dotName) {
    // Count how many targets have this dot
    if (!combat.targets || !Array.isArray(combat.targets)) {
      return 0;
    }
    return combat.targets.filter(unit => unit && unit.hasAura && unit.hasAura(dotName)).length;
  }
  

  /**
   * Checks if a specific variable exists for a spell or game state
   * 
   * @param {string} variableName - The name of the variable to check
   * @returns {boolean} True if the variable exists and is set, false otherwise
   */
  hasVariable(variableName) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Return true if the variable exists, false otherwise
    return this._variables[variableName] === true;
  }

  /**
   * Gets a variable's value for tracking spell states or conditions
   * 
   * @param {string} variableName - The name of the variable to get
   * @returns {any} The variable value or undefined if not set
   */
  getVariable(variableName) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    return this._variables[variableName];
  }
  
  /**
   * Sets a variable for tracking spell states or conditions
   * 
   * @param {string} variableName - The name of the variable to set
   * @param {any} value - The value to set
   */
  setVariable(variableName, value = true) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Set the variable
    this._variables[variableName] = value;
  }
  
  /**
   * Clears a variable
   * 
   * @param {string} variableName - The name of the variable to clear
   */
  clearVariable(variableName) {
    // Initialize variables object if it doesn't exist
    if (!this._variables) {
      this._variables = {};
    }
    
    // Remove the variable
    delete this._variables[variableName];
  }

  getGcdMax() {
    // Get the base GCD value (usually 1.5s without haste)
    return 1500 / (1 + (me.modSpellHaste / 100));
  }
  /**
   * Initializes the variables system for the rotation
   * This should be called when the behavior starts
   */
  initializeVariables() {
    // Create the variables storage if it doesn't exist
    this._variables = {};
    
    // Set initial values for key variables based on APL
    this.setVariable("dr_prep_time_aoe", Settings.EvokerDevastationDRPrepTimeAOE * 1000);
    this.setVariable("pool_for_cb", false);
    this.setVariable("dr_prep_time_st", Settings.EvokerDevastationDRPrepTimeST * 1000);
    this.setVariable("can_extend_dr", false);
    this.setVariable("pyre_st", false); // Per APL
    this.setVariable("es_send_threshold", Settings.EvokerDevastationESSendThreshold || 8);
    this.setVariable("pool_for_id", Settings.EvokerDevastationPoolResourcesForDR);
    this.setVariable("next_dragonrage", 999999); // Initialize with large value, updated in updateVariables
    return bt.Status.succes;
  }
}