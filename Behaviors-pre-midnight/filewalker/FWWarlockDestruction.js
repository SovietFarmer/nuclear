import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import CommandListener from "@/Core/CommandListener";

/**
 * Behavior implementation for Destruction Warlock
 * Follows Diabolist Hero talent build
 */
export class DestructionWarlockBehavior extends Behavior {
  // Define context, specialization, name, and version
  context = BehaviorContext.Any;
  specialization = Specialization.Warlock.Destruction;
  name = "FW Destruction Warlock";
  version = 1;
  
  // Define talent build options
  static TALENT_BUILDS = {
    DIABOLIST: 'diabolist',
    HELLCALLER: 'hellcaller'
  };
  
  /**
   * Settings for the behavior
   * These will appear in the UI settings panel
   */
  static settings = [
    {
      header: "Destruction Warlock Configuration",
      options: [
        {
          uid: "UseTrinkets",
          text: "Use Trinkets",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseRacials",
          text: "Use Racial Abilities",
          type: "checkbox",
          default: true
        },
        {
          uid: "AllowRoF2TSpender",
          text: "Use Rain of Fire for 2 targets",
          type: "checkbox",
          default: true,
          description: "Use Rain of Fire as a spender with 2 targets"
        },
        {
          uid: "DisableCB2T",
          text: "Disable Chaos Bolt at 2 targets",
          type: "checkbox",
          default: false,
          description: "Don't cast Chaos Bolt when fighting 2 targets"
        }
      ]
    }
  ];

  // Inside build() method where AoE detection occurs
  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
      Common.waitForTarget(),
      Common.waitForFacing(),
      this.preCombat(),
      // Process queued spells from CommandListener
      new bt.Action(() => {
        const queuedSpell = CommandListener.getNextQueuedSpell();
        if (queuedSpell) {
          CommandListener.processQueuedSpell();
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      // Main rotation selector
      new bt.Selector(
        // AoE rotation for 3+ targets
        new bt.Decorator(
          () => {
            // Use 8 yards for Rain of Fire range check (standard AoE radius)
            const enemyCount = this.getEnemyCount(8);
            return enemyCount >= 3;
          },
          this.aoeRotation(),
          "AoE Rotation (3+ targets)"
        ),
        // Cleave rotation for 2 targets or with cleave_apl variable set
        new bt.Decorator(
          () => {
            // Use 8 yards for cleave/AoE detection
            const enemyCount = this.getEnemyCount(8);
            return enemyCount === 2 || this.isCleaveModeActive();
          },
          this.cleaveRotation(),
          "Cleave Rotation"
        ),
        // Single-target rotation
        this.singleTargetRotation()
      )
    );
  }

  /**
   * Pre-combat sequence
   */
  preCombat() {
    return new bt.Sequence("Pre-Combat",
      new bt.Decorator(
        () => !me.inCombat(),
        new bt.Selector(
          // Summon demon if needed
          Spell.cast("Summon Imp", () => !me.pet),
          // Grimoire of Sacrifice if talented
          Spell.cast("Grimoire of Sacrifice", () => Spell.isSpellKnown("Grimoire of Sacrifice") && me.pet),
          // Cataclysm as pre-pull for AoE
          Spell.cast("Cataclysm", () => this.getEnemyCount() >= 2 && Spell.isSpellKnown("Cataclysm")),
          // Soul Fire pre-pull
          Spell.cast("Soul Fire", () => Spell.isSpellKnown("Soul Fire") && me.target)
        )
      )
    );
  }

  /**
   * Single-target rotation following SIMC APL
   */
  singleTargetRotation() {
    return new bt.Selector("Single Target Rotation",
      // Use on-GCD trinkets and racials
    //   this.useItems(),
      this.useOGCDs(),
      
      // Malevolence if Summon Infernal cooldown is high
      Spell.cast("Malevolence", () => me.hasAura("Malevolance") && Spell.isSpellKnown("Malevolence") && 
                 Spell.getCooldown("Summon Infernal").timeleft >= 55000),
      
      // Wait for Diabolic Ritual if active and almost done
      new bt.Action(() => {
        if (Spell.isSpellKnown("Diabolic Ritual")) {
          const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
          const overlord = me.getAura("Diabolic Ritual: Overlord");
          const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
          
          const motherRemains = motherOfChaos ? motherOfChaos.remaining : 0;
          const overlordRemains = overlord ? overlord.remaining : 0;
          const pitLordRemains = pitLord ? pitLord.remaining : 0;
          
          const totalRemains = motherRemains + overlordRemains + pitLordRemains;
          
          if (totalRemains > 0 && totalRemains < me.gcdMax * 0.25 && me.soul_shard > 2) {
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      }),
      
      // Demonic Art priority
      Spell.cast("Chaos Bolt", () => me.hasAura("Demonic Art")),
      
      // Soul Fire with Decimation proc
      Spell.cast("Soul Fire", () => {
        const decimation = me.getAura("Decimation");
        if (!decimation) return false;
        
        const conflagrate = this.getCurrentTarget().getAuraByMe("Conflagrate");
        const conflagrateRemains = conflagrate ? conflagrate.remaining : 0;
        
        return decimation && 
               (me.soul_shard <= 4 || decimation.remaining <= me.gcdMax * 2) && 
               conflagrateRemains >= Spell.getSpell("Soul Fire").castTime;
      }),
      
      // Wither with Internal Combustion
      Spell.cast("Wither", () => {
        if (!Spell.isSpellKnown("Internal Combustion")) return false;
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const wither = target.getAuraByMe("Wither");
        const witherRemains = wither ? wither.remaining : 0;
        const witherDuration = wither ? wither.duration : 0;
        
        const chaosBoltInFlight = this.isActionInFlight("Chaos Bolt");
        const adjustedRemains = witherRemains - (chaosBoltInFlight ? 5000 : 0);
        
        // Check if we need to refresh Wither based on conditions from APL
        if ((adjustedRemains < witherDuration * 0.4) || 
            witherRemains < 3000 || 
            (witherRemains - Spell.getSpell("Chaos Bolt").castTime < 5000 && 
             Spell.getSpell("Chaos Bolt").isUsable)) {
            
          // Additional Soul Fire check
          if (Spell.isSpellKnown("Soul Fire")) {
            const soulFireCd = Spell.getCooldown("Soul Fire");
            if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= (witherRemains - 5000)) {
              return false;
            }
          }
          
          return target.timeToDeath() > 8 && !this.isActionInFlight("Soul Fire", target);
        }
        
        return false;
      }),
      
      // Conflagrate with Roaring Blaze or about to cap charges
      Spell.cast("Conflagrate", () => {
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const conflagrate = target.getAuraByMe("Conflagrate");
        const conflagrateRemains = conflagrate ? conflagrate.remaining : 0;
        
        const hasDiabolicRitual = Spell.isSpellKnown("Diabolic Ritual");
        
        // Check ritual buff remains if talented
        let ritualRemains = 0;
        if (hasDiabolicRitual) {
          const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
          const overlord = me.getAura("Diabolic Ritual: Overlord");
          const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
          
          ritualRemains = (motherOfChaos ? motherOfChaos.remaining : 0) + 
                          (overlord ? overlord.remaining : 0) + 
                          (pitLord ? pitLord.remaining : 0);
        }
        
        return (Spell.isSpellKnown("Roaring Blaze") && conflagrateRemains < 1500) || 
               Spell.getCooldown("Conflagrate").fullRechargeTime <= me.gcdMax * 2 || 
               (Spell.getCooldown("Conflagrate").timeleft <= 8000 && 
                hasDiabolicRitual && ritualRemains < me.gcdMax && 
                me.soul_shard >= 1.5);
      }),
      
      // Shadowburn for special conditions
      Spell.cast("Shadowburn", () => {
        if (!Spell.isSpellKnown("Shadowburn")) return false;
        
        const cooldown = Spell.getCooldown("Shadowburn");
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const eradication = target.getAuraByMe("Eradication");
        const eradicationRemains = eradication ? eradication.remaining : 0;
        
        const hasConflagrationOfChaos = Spell.isSpellKnown("Conflagration of Chaos");
        const hasBlisteringAtrophy = Spell.isSpellKnown("Blistering Atrophy");
        const hasDiabolicRitual = Spell.isSpellKnown("Diabolic Ritual");
        
        // Main condition from APL
        const condition = (cooldown.fullRechargeTime <= me.gcdMax * 3 || 
                          (eradicationRemains <= me.gcdMax && 
                           Spell.isSpellKnown("Eradication") && 
                           !this.isActionInFlight("Chaos Bolt") && 
                           !hasDiabolicRitual)) && 
                          (hasConflagrationOfChaos || hasBlisteringAtrophy) && 
                          !me.hasAura("Demonic Art");
        
        return condition || this.getFightRemains() <= 8;
      }),
      
      // Chaos Bolt with Ritual of Ruin
      Spell.cast("Chaos Bolt", () => me.hasAura("Ritual of Ruin")),
      
      // Shadowburn or Chaos Bolt with Malevolence or Rain of Chaos condition
      Spell.cast("Shadowburn", () => {
        if (!Spell.isSpellKnown("Shadowburn")) return false;
        
        return (Spell.getCooldown("Summon Infernal").timeleft >= 90000 && 
                Spell.isSpellKnown("Rain of Chaos")) || 
               me.hasAura("Malevolence");
      }),
      
      Spell.cast("Chaos Bolt", () => {
        return (Spell.getCooldown("Summon Infernal").timeleft >= 90000 && 
                Spell.isSpellKnown("Rain of Chaos")) || 
               me.hasAura("Malevolence");
      }),
      
      // Ruination with Eradication check
      Spell.cast("Ruination", () => {
        const target = this.getCurrentTarget();
        if (!target) return false;
        if (!me.hasAura("Ruination")) return false;
        const eradication = target.getAuraByMe("Eradication");
        const eradicationRemains = eradication ? eradication.remaining : 0;
        
        return eradicationRemains >= Spell.getSpell("Ruination").castTime || 
               !Spell.isSpellKnown("Eradication") || 
               !Spell.isSpellKnown("Shadowburn");
      }),
      
      // Cataclysm for refreshing Wither
      Spell.cast("Cataclysm", () => {
        if (!Spell.isSpellKnown("Cataclysm")) return false;
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const wither = target.getAuraByMe("Wither");
        
        return Spell.isSpellKnown("Wither") && (!wither || wither.refreshable);
      }),
      
      // Channel Demonfire with Raging Demonfire
      Spell.cast("Channel Demonfire", () => {
        if (!Spell.isSpellKnown("Channel Demonfire") || !Spell.isSpellKnown("Raging Demonfire")) {
          return false;
        }
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const immolate = target.getAuraByMe("Immolate");
        const immolateRemains = immolate ? immolate.remaining : 0;
        
        const wither = target.getAuraByMe("Wither");
        const witherRemains = wither ? wither.remaining : 0;
        
        const chaosBoltInFlight = this.isActionInFlight("Chaos Bolt");
        const icReduction = chaosBoltInFlight && Spell.isSpellKnown("Internal Combustion") ? 5000 : 0;
        
        return (immolateRemains + witherRemains - icReduction) > Spell.getSpell("Channel Demonfire").castTime;
      }),
      
      // Wither without Internal Combustion
      Spell.cast("Wither", () => {
        if (!Spell.isSpellKnown("Wither") || Spell.isSpellKnown("Internal Combustion")) {
          return false;
        }
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const wither = target.getAuraByMe("Wither");
        const witherRemains = wither ? wither.remaining : 0;
        const witherDuration = wither ? wither.duration : 0;
        
        const chaosBoltInFlight = this.isActionInFlight("Chaos Bolt");
        const adjustedRemains = witherRemains - (chaosBoltInFlight ? 5000 : 0);
        
        // Don't refresh if Cataclysm will handle it
        if (Spell.isSpellKnown("Cataclysm") && 
            Spell.getCooldown("Cataclysm").timeleft <= witherRemains) {
          return false;
        }
        
        // Additional Soul Fire check
        if (Spell.isSpellKnown("Soul Fire")) {
          const soulFireCd = Spell.getCooldown("Soul Fire");
          if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= witherRemains) {
            return false;
          }
        }
        
        return ((adjustedRemains < witherDuration * 0.3) || witherRemains < 3000) && 
               target.timeToDeath() > 8 && 
               !this.isActionInFlight("Soul Fire", target);
      }),
      
      // Immolate refresh
      Spell.cast("Immolate", () => {
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const immolate = target.getAuraByMe("Immolate");
        const immolateRemains = immolate ? immolate.remaining : 0;
        const immolateDuration = immolate ? immolate.duration : 0;
        
        const chaosBoltInFlight = this.isActionInFlight("Chaos Bolt");
        const icReduction = chaosBoltInFlight && Spell.isSpellKnown("Internal Combustion") ? 5000 : 0;
        const adjustedRemains = immolateRemains - icReduction;
        
        const cbExecuteTime = Spell.getSpell("Chaos Bolt").castTime;
        
        // Special case for Internal Combustion
        if (Spell.isSpellKnown("Internal Combustion") && 
            (adjustedRemains < immolateDuration * 0.3 || 
             immolateRemains < 3000 || 
             (immolateRemains - cbExecuteTime < 5000 && 
              Spell.getSpell("Chaos Bolt").isUsable))) {
          
          // Additional Soul Fire check
          if (Spell.isSpellKnown("Soul Fire")) {
            const soulFireCd = Spell.getCooldown("Soul Fire");
            if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= (immolateRemains - 5000 * (Spell.isSpellKnown("Internal Combustion") ? 1 : 0))) {
              return false;
            }
          }
          
          return target.timeToDeath() > 8 && !this.isActionInFlight("Soul Fire", target);
        }
        
        return false;
      }),
      
      // Summon Infernal on cooldown
      Spell.cast("Summon Infernal"),
      
      // Incinerate for Diabolic Ritual timing
      Spell.cast("Incinerate", () => {
        if (!Spell.isSpellKnown("Diabolic Ritual")) return false;
        
        // Check ritual buff remains
        const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
        const overlord = me.getAura("Diabolic Ritual: Overlord");
        const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
        
        const totalRemains = (motherOfChaos ? motherOfChaos.remaining : 0) + 
                             (overlord ? overlord.remaining : 0) + 
                             (pitLord ? pitLord.remaining : 0);
        
        // Calculate timing adjustment based on disabling CB at 2T
        const disableCB2T = Settings.DisableCB2T || false;
        const cbCastTime = !disableCB2T ? Spell.getSpell("Chaos Bolt").castTime : 0;
        const gcdAdjustment = !disableCB2T ? me.gcdMax : 0;
        
        return totalRemains - 2000 - cbCastTime - gcdAdjustment <= 0;
      }),
      
      // Chaos Bolt when pooling
      Spell.cast("Chaos Bolt", () => {
        // Check pooling condition
        const poolingCondition = this.getPoolingConditionCB();
        
        // Check cooldown on Infernal
        const infernalCd = Spell.getCooldown("Summon Infernal");
        
        return poolingCondition && 
               (infernalCd.timeleft >= me.gcdMax * 3 || 
                me.soul_shard > 4 || 
                !Spell.isSpellKnown("Rain of Chaos"));
      }),
      
      // Channel Demonfire
      Spell.cast("Channel Demonfire"),
      
      // Dimensional Rift
      Spell.cast("Dimensional Rift"),
      
      // Infernal Bolt
      Spell.cast("Infernal Bolt"),
      
      // Conflagrate to avoid capping charges
      Spell.cast("Conflagrate", () => {
        const charges = Spell.getCharges("Conflagrate");
        const maxCharges = Spell.getSpell("Conflagrate").charges?.maxCharges || 0;
        
        return charges > (maxCharges - 1) || this.getFightRemains() < me.gcdMax * charges;
      }),
      
      // Soul Fire with Backdraft
      Spell.cast("Soul Fire", () => me.hasAura("Backdraft")),
      
      // Incinerate as filler
      Spell.cast("Incinerate")
    );
  }

  /**
   * AoE rotation for 3+ targets
   */
  aoeRotation() {
    return new bt.Selector("AoE Rotation",
      // Use OGCDs and items
      this.useOGCDs(),
    //   this.useItems(),
      
      // Malevolence in AoE with conditions
      Spell.cast("Malevolence", () => {
        if (!Spell.isSpellKnown("Malevolence")) return false;
        
        return Spell.getCooldown("Summon Infernal").timeleft >= 55000 && 
               me.soul_shard < 4.7 && 
               (this.getEnemyCount() <= 3 + this.getActiveDotCount("Wither") || 
                wow.frameTime > 30000);
      }),
      
      // Rain of Fire with Demonic Art
      Spell.cast("Rain of Fire", () => me.hasAura("Demonic Art")),
      
      // Wait for Diabolic Ritual if active and almost done
      new bt.Action(() => {
        if (Spell.isSpellKnown("Diabolic Ritual")) {
          const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
          const overlord = me.getAura("Diabolic Ritual: Overlord");
          const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
          
          const motherRemains = motherOfChaos ? motherOfChaos.remaining : 0;
          const overlordRemains = overlord ? overlord.remaining : 0;
          const pitLordRemains = pitLord ? pitLord.remaining : 0;
          
          const totalRemains = motherRemains + overlordRemains + pitLordRemains;
          
          if (totalRemains > 0 && totalRemains < me.gcdMax * 0.25 && me.soul_shard > 2) {
            return bt.Status.Success;
          }
        }
        return bt.Status.Failure;
      }),
      
      // Incinerate during Diabolic Ritual
      Spell.cast("Incinerate", () => {
        if (!Spell.isSpellKnown("Diabolic Ritual")) return false;
        
        // Check ritual buff remains
        const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
        const overlord = me.getAura("Diabolic Ritual: Overlord");
        const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
        
        const motherRemains = motherOfChaos ? motherOfChaos.remaining : 0;
        const overlordRemains = overlord ? overlord.remaining : 0;
        const pitLordRemains = pitLord ? pitLord.remaining : 0;
        
        const totalRemains = motherRemains + overlordRemains + pitLordRemains;
        
        const castTime = Spell.getSpell("Incinerate").castTime;
        
        return totalRemains <= castTime && totalRemains > me.gcdMax * 0.25;
      }),
      
      // Rain of Fire for soul shard dumps
      Spell.cast("Rain of Fire", () => {
        if (!Spell.isSpellKnown("Inferno")) {
          const activeDots = this.getActiveDotCount("Immolate") + this.getActiveDotCount("Wither");
          return me.soul_shard >= (4.5 - 0.1 * activeDots) || 
                 me.soul_shard >= (3.5 - 0.1 * activeDots) || 
                 me.hasAura("Ritual of Ruin");
        }
        return false;
      }),
      
      // Wither on highest priority target without Wither
      Spell.cast("Wither", () => {
        if (!Spell.isSpellKnown("Wither")) return false;
        
        const target = this.getBestDotTarget("Wither");
        if (!target) return false;
        
        const wither = target.getAuraByMe("Wither");
        
        // Don't cast if Cataclysm is coming up soon
        if (Spell.isSpellKnown("Cataclysm") && 
            Spell.getCooldown("Cataclysm").timeleft <= (wither ? wither.remaining : 0)) {
          return false;
        }
        
        // Check Channel Demonfire conditions
        if (Spell.isSpellKnown("Raging Demonfire") && 
            Spell.isSpellKnown("Channel Demonfire") && 
            Spell.getCooldown("Channel Demonfire").timeleft <= (wither ? wither.remaining : 0) && 
            wow.frameTime < 5000) {
          return false;
        }
        
        // Limit number of targets with Wither
        const activeDots = this.getActiveDotCount("Wither");
        if (activeDots > 4 && wow.frameTime <= 15000) {
          return false;
        }
        
        return (!wither || wither.refreshable) && target.timeToDeath() > 18;
      }),
      
      // Channel Demonfire with Raging Demonfire
      Spell.cast("Channel Demonfire", () => {
        if (!Spell.isSpellKnown("Channel Demonfire") || !Spell.isSpellKnown("Raging Demonfire")) {
          return false;
        }
        
        // Need at least one target with Immolate or Wither
        let hasValidTarget = false;
        combat.targets.forEach(target => {
          const immolate = target.getAuraByMe("Immolate");
          const wither = target.getAuraByMe("Wither");
          
          if ((immolate && immolate.remaining > Spell.getSpell("Channel Demonfire").castTime) || 
              (wither && wither.remaining > Spell.getSpell("Channel Demonfire").castTime)) {
            hasValidTarget = true;
          }
        });
        
        return hasValidTarget;
      }),
      
      // Ruination
      Spell.cast("Ruination", () => me.hasAura("Ruination")),
      
      // Rain of Fire during Infernal with Rain of Chaos
      Spell.cast("Rain of Fire", () => {
        return me.hasAura("Infernal") && Spell.isSpellKnown("Rain of Chaos");
      }),
      
      // Cataclysm
      Spell.cast("Cataclysm", () => Spell.isSpellKnown("Wither") || true),
      
      // Summon Infernal
      Spell.cast("Summon Infernal", () => {
        // Check for PI/External cooldowns
        // Since we don't have direct access to those in the code framework, simplify
        return true;
      }),
      
      // Immolate maintenance on targets
      Spell.cast("Immolate", () => {
        const target = this.getBestDotTarget("Immolate");
        if (!target) return false;
        
        const immolate = target.getAuraByMe("Immolate");
        
        // Don't cast if Cataclysm is coming up soon
        if (Spell.isSpellKnown("Cataclysm") && 
            Spell.getCooldown("Cataclysm").timeleft <= (immolate ? immolate.remaining : 0)) {
          return false;
        }
        
        // Channel Demonfire conditions
        if (Spell.isSpellKnown("Raging Demonfire") && 
            Spell.isSpellKnown("Channel Demonfire") && 
            Spell.getCooldown("Channel Demonfire").timeleft <= (immolate ? immolate.remaining : 0) && 
            wow.frameTime < 5000) {
          return false;
        }
        
        // Limit number of targets with Immolate based on talents
        const limit = (Spell.isSpellKnown("Diabolic Ritual") && Spell.isSpellKnown("Inferno")) ? 6 : 4;
        const activeDots = this.getActiveDotCount("Immolate");
        
        return (!immolate || immolate.refreshable) && 
               activeDots <= limit && 
               target.timeToDeath() > 18;
      }),
      
      // Dimensional Rift
      Spell.cast("Dimensional Rift", () => me.soul_shard < 4.7),
      
      // Soul Fire with Decimation
      Spell.cast("Soul Fire", () => {
        if (!Spell.isSpellKnown("Soul Fire")) return false;
        
        return me.hasAura("Decimation") && 
               this.getActiveDotCount("Immolate") <= 4;
      }),
      
      // Infernal Bolt for shard generation
      Spell.cast("Infernal Bolt", () => me.soul_shard < 2.5),
      
      // Conflagrate for Backdraft in AoE
      Spell.cast("Conflagrate", () => {
        if (!Spell.isSpellKnown("Backdraft")) return false;
        
        const backdraft = me.getAura("Backdraft");
        return !backdraft || backdraft.stacks < 2;
      }),
      
      // Incinerate with Fire and Brimstone and Backdraft
      Spell.cast("Incinerate", () => {
        return Spell.isSpellKnown("Fire and Brimstone") && me.hasAura("Backdraft");
      }),
      
      // Conflagrate as filler
      Spell.cast("Conflagrate"),
      
      // Incinerate as filler
      Spell.cast("Incinerate")
    );
  }

  /**
   * Cleave rotation (2 targets)
   */
  cleaveRotation() {
    return new bt.Selector("Cleave Rotation",
      // Use items and OGCDs
    //   this.useItems(),
      this.useOGCDs(),
      
      // Handle Havoc if active
      this.havocRotation(),
      
      // Variable to track soul shard pooling
      new bt.Action(() => {
        this.poolSoulShards = Spell.getCooldown("Havoc").timeleft <= 5000 || Spell.isSpellKnown("Mayhem");
        return bt.Status.Failure;
      }),
      
      // Malevolence if not during Infernal
      Spell.cast("Malevolence", () => {
        if (!Spell.isSpellKnown("Malevolence")) return false;
        
        return !me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal");
      }),
      
      // Havoc setup on non-primary target
      Spell.cast("Havoc", () => {
        if (!Spell.isSpellKnown("Havoc")) return false;
        
        const currentTarget = this.getCurrentTarget();
        if (!currentTarget) return false;
        
        // Find best Havoc target that isn't current target
        let bestTarget = null;
        let highestPriority = -99999;
        
        combat.targets.forEach(target => {
          if (target !== currentTarget) {
            // Calculate priority based on time to die and DoT status
            const timeToLive = target.timeToDeath() || -15;
            const immolate = target.getAuraByMe("Immolate");
            const immolateRemains = immolate ? immolate.remaining : 0;
            
            // Priority formula from APL
            const priority = (-timeToLive) + immolateRemains + (currentTarget === target ? 99 : 0);
            
            if (priority > highestPriority) {
              highestPriority = priority;
              bestTarget = target;
            }
          }
        });
        
        if (!bestTarget) return false;
        
        // Check conditions from APL
        return (!me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal")) && 
               bestTarget.timeToDeath() > 8;
      }),
      
      // Demonic Art priority
      Spell.cast("Chaos Bolt", () => me.hasAura("Demonic Art")),
      
      // Soul Fire with Decimation during cooldown
      Spell.cast("Soul Fire", () => {
        if (!Spell.isSpellKnown("Soul Fire") || !me.hasAura("Decimation")) return false;
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const conflagrate = target.getAuraByMe("Conflagrate");
        
        return me.hasAura("Decimation") && 
               (me.soul_shard <= 4 || me.getAura("Decimation").remaining <= me.gcdMax * 2) && 
               conflagrate && conflagrate.remaining >= Spell.getSpell("Soul Fire").castTime && 
               Spell.getCooldown("Havoc").timeleft > 0;
      }),
      
      // DoT maintenance through the rest of the cleave rotation
      Spell.cast("Wither", () => {
        if (!Spell.isSpellKnown("Wither")) return false;
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const wither = target.getAuraByMe("Wither");
        const witherRemains = wither ? wither.remaining : 0;
        const witherDuration = wither ? wither.duration : 0;
        
        const chaosBoltInFlight = this.isActionInFlight("Chaos Bolt");
        const adjustedRemains = witherRemains - (chaosBoltInFlight ? 5000 : 0);
        
        // This covers both Internal Combustion and non-IC cases from the APL
        if (Spell.isSpellKnown("Internal Combustion")) {
          // Internal Combustion logic
          if ((adjustedRemains < witherDuration * 0.4) || 
              witherRemains < 3000 || 
              (witherRemains - Spell.getSpell("Chaos Bolt").castTime < 5000 && 
               Spell.getSpell("Chaos Bolt").isUsable)) {
            
            // Additional Soul Fire check
            if (Spell.isSpellKnown("Soul Fire")) {
              const soulFireCd = Spell.getCooldown("Soul Fire");
              if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= (witherRemains - 5000)) {
                return false;
              }
            }
            
            return target.timeToDeath() > 8 && !this.isActionInFlight("Soul Fire", target);
          }
        } else {
          // Non-Internal Combustion logic
          if ((adjustedRemains < witherDuration * 0.3) || witherRemains < 3000) {
            // Additional Soul Fire check
            if (Spell.isSpellKnown("Soul Fire")) {
              const soulFireCd = Spell.getCooldown("Soul Fire");
              if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= witherRemains) {
                return false;
              }
            }
            
            return target.timeToDeath() > 8 && !this.isActionInFlight("Soul Fire", target);
          }
        }
        
        return false;
      }),
      
      // Conflagrate with Roaring Blaze
      Spell.cast("Conflagrate", () => {
        if (this.poolSoulShards) return false; // Don't use if pooling for Havoc
        
        if (Spell.isSpellKnown("Roaring Blaze")) {
          return Spell.getCooldown("Conflagrate").fullRechargeTime <= me.gcdMax * 2;
        }
        
        // Check for Diabolic Ritual timing
        if (Spell.isSpellKnown("Diabolic Ritual")) {
          const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
          const overlord = me.getAura("Diabolic Ritual: Overlord");
          const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
          
          const totalRemains = (motherOfChaos ? motherOfChaos.remaining : 0) + 
                               (overlord ? overlord.remaining : 0) + 
                               (pitLord ? pitLord.remaining : 0);
          
          if (Spell.getCooldown("Conflagrate").timeleft <= 8000 && 
              totalRemains < me.gcdMax && me.soul_shard >= 1.5) {
            return true;
          }
        }
        
        return false;
      }),
      
      // Shadowburn with talent conditions
      Spell.cast("Shadowburn", () => {
        if (!Spell.isSpellKnown("Shadowburn")) return false;
        
        const cooldown = Spell.getCooldown("Shadowburn");
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const eradication = target.getAuraByMe("Eradication");
        const eradicationRemains = eradication ? eradication.remaining : 0;
        
        const hasConflagrationOfChaos = Spell.isSpellKnown("Conflagration of Chaos");
        const hasBlisteringAtrophy = Spell.isSpellKnown("Blistering Atrophy");
        const hasDiabolicRitual = Spell.isSpellKnown("Diabolic Ritual");
        
        // Main condition from APL
        const condition = (cooldown.fullRechargeTime <= me.gcdMax * 3 || 
                          (eradicationRemains <= me.gcdMax && 
                           Spell.isSpellKnown("Eradication") && 
                           !this.isActionInFlight("Chaos Bolt") && 
                           !hasDiabolicRitual)) && 
                          (hasConflagrationOfChaos || hasBlisteringAtrophy);
        
        return condition || this.getFightRemains() <= 8;
      }),
      
      // Chaos Bolt with Ritual of Ruin
      Spell.cast("Chaos Bolt", () => me.hasAura("Ritual of Ruin")),
      
      // Rain of Fire with Rain of Chaos
      Spell.cast("Rain of Fire", () => {
        return Spell.getCooldown("Summon Infernal").timeleft >= 90000 && 
               Spell.isSpellKnown("Rain of Chaos");
      }),
      
      // Shadowburn with Rain of Chaos
      Spell.cast("Shadowburn", () => {
        if (!Spell.isSpellKnown("Shadowburn")) return false;
        
        return Spell.getCooldown("Summon Infernal").timeleft >= 90000 && 
               Spell.isSpellKnown("Rain of Chaos");
      }),
      
      // Chaos Bolt with Rain of Chaos
      Spell.cast("Chaos Bolt", () => {
        return Spell.getCooldown("Summon Infernal").timeleft >= 90000 && 
               Spell.isSpellKnown("Rain of Chaos");
      }),
      
      // Ruination with Eradication check
      Spell.cast("Ruination", () => {
        const target = this.getCurrentTarget();
        if (!target) return false;
        if (!me.hasAura("Ruination")) return false;
        
        const eradication = target.getAuraByMe("Eradication");
        const eradicationRemains = eradication ? eradication.remaining : 0;
        
        return eradicationRemains >= Spell.getSpell("Ruination").castTime || 
               !Spell.isSpellKnown("Eradication") || 
               !Spell.isSpellKnown("Shadowburn");
      }),
      
      // Cataclysm for AoE DoT application
      Spell.cast("Cataclysm"),
      
      // Immolate maintenance that considers Havoc timing
      Spell.cast("Immolate", () => {
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const immolate = target.getAuraByMe("Immolate");
        const immolateRefreshable = immolate ? immolate.refreshable : true;
        
        // Only refresh if Immolate will expire before Havoc is ready
        if (immolateRefreshable && 
            (immolate ? immolate.remaining : 0) < Spell.getCooldown("Havoc").timeleft) {
          
          // Don't cast if Cataclysm will handle it
          if (Spell.isSpellKnown("Cataclysm") && 
              Spell.getCooldown("Cataclysm").timeleft <= (immolate ? immolate.remaining : 0)) {
            return false;
          }
          
          // Additional Soul Fire check
          if (Spell.isSpellKnown("Soul Fire") && !Spell.isSpellKnown("Mayhem")) {
            const soulFireCd = Spell.getCooldown("Soul Fire");
            if (soulFireCd.timeleft + Spell.getSpell("Soul Fire").castTime <= (immolate ? immolate.remaining : 0)) {
              return false;
            }
          }
          
          return target.timeToDeath() > 15;
        }
        
        return false;
      }),
      
      // Summon Infernal
      Spell.cast("Summon Infernal"),
      
      // Incinerate for Diabolic Ritual
      Spell.cast("Incinerate", () => {
        if (!Spell.isSpellKnown("Diabolic Ritual")) return false;
        
        // Check ritual buff remains
        const motherOfChaos = me.getAura("Diabolic Ritual: Mother of Chaos");
        const overlord = me.getAura("Diabolic Ritual: Overlord");
        const pitLord = me.getAura("Diabolic Ritual: Pit Lord");
        
        const totalRemains = (motherOfChaos ? motherOfChaos.remaining : 0) + 
                             (overlord ? overlord.remaining : 0) + 
                             (pitLord ? pitLord.remaining : 0);
        
        // Calculate timing adjustment based on disabling CB at 2T
        const disableCB2T = Settings.DisableCB2T || false;
        const cbCastTime = !disableCB2T ? Spell.getSpell("Chaos Bolt").castTime : 0;
        const gcdAdjustment = !disableCB2T ? me.gcdMax : 0;
        
        return totalRemains - 2000 - cbCastTime - gcdAdjustment <= 0;
      }),
      
      // Rain of Fire with Rain of Chaos buff or when appropriate for AoE
      Spell.cast("Rain of Fire", () => {
        // Get enemy count specifically for this decision
        const enemyCount = this.getEnemyCount(8);
        
        if (enemyCount >= 3) {
          return true; // Always use Rain of Fire with 3+ targets
        } else if (enemyCount === 2 && this.shouldDoRoF2T()) {
          console.info("Using Rain of Fire for 2 targets because shouldDoRoF2T() returned true");
          return this.getPoolingCondition() && 
                 (Spell.getCooldown("Summon Infernal").timeleft >= me.gcdMax * 3 || 
                  !Spell.isSpellKnown("Rain of Chaos"));
        }
        
        // Use for single target only if we have Rain of Chaos proc
        return !Spell.isSpellKnown("Wither") && me.hasAura("Rain of Chaos") && this.getPoolingCondition();
      }),
      
      // Rain of Fire with Pyrogenics about to expire
      Spell.cast("Rain of Fire", () => {
        if (!this.allowRoF2TSpender() || Spell.isSpellKnown("Wither")) return false;
        
        const target = this.getCurrentTarget();
        if (!target) return false;
        
        const pyrogenics = target.getAuraByMe("Pyrogenics");
        const pyrogenicsRemains = pyrogenics ? pyrogenics.remaining : 0;
        
        const poolingCondition = this.getPoolingCondition();
        
        return Spell.isSpellKnown("Pyrogenics") && 
               pyrogenicsRemains <= me.gcdMax && 
               (!Spell.isSpellKnown("Rain of Chaos") || 
                Spell.getCooldown("Summon Infernal").timeleft >= me.gcdMax * 3) && 
               poolingCondition;
      }),
      
      // Rain of Fire for 2T when appropriate
      Spell.cast("Rain of Fire", () => {
        return this.shouldDoRoF2T() && 
               this.getPoolingCondition() && 
               (Spell.getCooldown("Summon Infernal").timeleft >= me.gcdMax * 3 || 
                !Spell.isSpellKnown("Rain of Chaos"));
      }),
      
      // Soul Fire with Mayhem
      Spell.cast("Soul Fire", () => {
        return Spell.isSpellKnown("Soul Fire") && 
               me.soul_shard <= 4 && 
               Spell.isSpellKnown("Mayhem");
      }),
      
      // Chaos Bolt when appropriate
      Spell.cast("Chaos Bolt", () => {
        if (this.shouldDisableCB2T()) return false;
        
        const poolingCondition = this.getPoolingConditionCB();
        
        return poolingCondition && 
               (Spell.getCooldown("Summon Infernal").timeleft >= me.gcdMax * 3 || 
                me.soul_shard > 4 || 
                !Spell.isSpellKnown("Rain of Chaos"));
      }),
      
      // Channel Demonfire
      Spell.cast("Channel Demonfire"),
      
      // Dimensional Rift
      Spell.cast("Dimensional Rift"),
      
      // Infernal Bolt
      Spell.cast("Infernal Bolt"),
      
      // Conflagrate to avoid capping charges
      Spell.cast("Conflagrate", () => {
        const charges = Spell.getCharges("Conflagrate");
        const maxCharges = Spell.getSpell("Conflagrate").charges?.maxCharges || 0;
        
        return charges > (maxCharges - 1) || this.getFightRemains() < me.gcdMax * charges;
      }),
      
      // Incinerate as filler
      Spell.cast("Incinerate")
    );
  }

  /**
   * Havoc-specific rotation
   */
  havocRotation() {
    return new bt.Decorator(
      () => this.isHavocActive() && this.getHavocRemains() > me.gcdMax,
      new bt.Selector("Havoc Rotation",
        // Conflagrate for Backdraft generation
        Spell.cast("Conflagrate", () => {
          return Spell.isSpellKnown("Backdraft") && 
                 !me.hasAura("Backdraft") && 
                 me.soul_shard >= 1 && 
                 me.soul_shard <= 4;
        }),
        
        // Soul Fire if it will complete during Havoc
        Spell.cast("Soul Fire", () => {
          if (!Spell.isSpellKnown("Soul Fire")) return false;
          
          const castTime = Spell.getSpell("Soul Fire").castTime;
          
          return castTime < this.getHavocRemains() && me.soul_shard < 2.5;
        }),
        
        // Cataclysm for mass AoE
        Spell.cast("Cataclysm", () => {
          if (!Spell.isSpellKnown("Cataclysm")) return false;
          
          // Check if we have Wither and it needs refreshing
          if (Spell.isSpellKnown("Wither")) {
            const target = this.getCurrentTarget();
            if (target) {
              const wither = target.getAuraByMe("Wither");
              if (wither && wither.remains < wither.duration * 0.3) {
                return true;
              }
            }
          }
          
          return true;
        }),
        
        // DoT maintenance with Havoc priority checks
        Spell.cast("Immolate", () => {
          // Find best target for Immolate during Havoc
          let bestTarget = null;
          let lowestRemaining = 99999;
          
          combat.targets.forEach(target => {
            const immolate = target.getAuraByMe("Immolate");
            const immolateRemains = immolate ? immolate.remaining : 0;
            const hasHavoc = target.hasAuraByMe("Havoc");
            
            // Calculate havoc_immo_time calculation from APL
            const havocImmoTime = hasHavoc ? immolateRemains : 0;
            
            if ((!immolate || immolate.refreshable) && havocImmoTime < 5400 && target.timeToDeath() > 5) {
              if (immolateRemains < lowestRemaining) {
                lowestRemaining = immolateRemains;
                bestTarget = target;
              }
            } else if ((immolateRemains < 2000 && immolateRemains < this.getHavocRemains()) || 
                      !immolate || havocImmoTime < 2000) {
              if (target.timeToDeath() > 11 && me.soul_shard < 4.5) {
                if (immolateRemains < lowestRemaining) {
                  lowestRemaining = immolateRemains;
                  bestTarget = target;
                }
              }
            }
          });
          
          return bestTarget !== null;
        }),
        
        // Wither maintenance with similar logic
        Spell.cast("Wither", () => {
          if (!Spell.isSpellKnown("Wither")) return false;
          
          // Find best target for Wither during Havoc
          let bestTarget = null;
          let lowestRemaining = 99999;
          
          combat.targets.forEach(target => {
            const wither = target.getAuraByMe("Wither");
            const witherRemains = wither ? wither.remaining : 0;
            const hasHavoc = target.hasAuraByMe("Havoc");
            
            // Calculate havoc_immo_time calculation from APL
            const havocImmoTime = hasHavoc ? witherRemains : 0;
            
            if ((!wither || wither.refreshable) && havocImmoTime < 5400 && target.timeToDeath() > 5) {
              if (witherRemains < lowestRemaining) {
                lowestRemaining = witherRemains;
                bestTarget = target;
              }
            } else if ((witherRemains < 2000 && witherRemains < this.getHavocRemains()) || 
                      !wither || havocImmoTime < 2000) {
              if (target.timeToDeath() > 11 && me.soul_shard < 4.5) {
                if (witherRemains < lowestRemaining) {
                  lowestRemaining = witherRemains;
                  bestTarget = target;
                }
              }
            }
          });
          
          return bestTarget !== null;
        }),
        
        // Shadowburn during Havoc
        Spell.cast("Shadowburn", () => {
          if (!Spell.isSpellKnown("Shadowburn")) return false;
          
          // Check for the conditions in APL
          if (this.getEnemyCount() <= 4) {
            const cooldown = Spell.getCooldown("Shadowburn");
            const target = this.getCurrentTarget();
            if (!target) return false;
            
            const eradication = target.getAuraByMe("Eradication");
            const eradicationRemains = eradication ? eradication.remaining : 0;
            
            const hasConflagrationOfChaos = Spell.isSpellKnown("Conflagration of Chaos");
            const hasBlisteringAtrophy = Spell.isSpellKnown("Blistering Atrophy");
            const hasDiabolicRitual = Spell.isSpellKnown("Diabolic Ritual");
            
            // Main condition from APL
            const condition = (cooldown.fullRechargeTime <= me.gcdMax * 3 || 
                              (eradicationRemains <= me.gcdMax && 
                               Spell.isSpellKnown("Eradication") && 
                               !this.isActionInFlight("Chaos Bolt") && 
                               !hasDiabolicRitual)) && 
                              (hasConflagrationOfChaos || hasBlisteringAtrophy);
            
            // Also cast if Havoc is about to fade
            const havocEndingSoon = this.getHavocRemains() <= me.gcdMax * 3;
            
            return condition || havocEndingSoon;
          }
          
          return false;
        }),
        
        // Chaos Bolt during Havoc with target count checks
        Spell.cast("Chaos Bolt", () => {
          const castTime = Spell.getSpell("Chaos Bolt").castTime;
          if (castTime >= this.getHavocRemains()) return false;
          
          // Check enemy count conditions from APL
          if (!Spell.isSpellKnown("Improved Chaos Bolt") && this.getEnemyCount() <= 2) {
            return true;
          } else if (Spell.isSpellKnown("Improved Chaos Bolt")) {
            if (Spell.isSpellKnown("Wither") && Spell.isSpellKnown("Inferno") && this.getEnemyCount() <= 2) {
              return true;
            } else if ((Spell.isSpellKnown("Wither") && Spell.isSpellKnown("Cataclysm")) || 
                       (!Spell.isSpellKnown("Wither") && Spell.isSpellKnown("Inferno"))) {
              return this.getEnemyCount() <= 3;
            } else if (!Spell.isSpellKnown("Wither") && Spell.isSpellKnown("Cataclysm")) {
              return this.getEnemyCount() <= 5;
            }
          }
          
          return false;
        }),
        
        // Rain of Fire for 3+ targets during Havoc
        Spell.cast("Rain of Fire", () => this.getEnemyCount() >= 3),
        
        // Channel Demonfire during Havoc
        Spell.cast("Channel Demonfire", () => me.soul_shard < 4.5),
        
        // Conflagrate if not using Backdraft
        Spell.cast("Conflagrate", () => !Spell.isSpellKnown("Backdraft")),
        
        // Dimensional Rift
        Spell.cast("Dimensional Rift", () => {
          return me.soul_shard < 4.7 && 
                 (Spell.getCharges("Dimensional Rift") > 2 || 
                  this.getFightRemains() < Spell.getCooldown("Dimensional Rift").duration);
        }),
        
        // Incinerate as filler during Havoc
        Spell.cast("Incinerate", () => {
          const castTime = Spell.getSpell("Incinerate").castTime;
          return castTime < this.getHavocRemains();
        })
      ),
      "Active Havoc Handler"
    );
  }

  /**
   * Use trinkets and on-use items
   */
  useItems() {
    return new bt.Selector("Use Items",
      // Spymaster's Web with specific conditions
      Common.useEquippedItemByName("Spymaster's Web", () => {
        const infernalRemains = this.getInfernalRemains();
        const hasSpymastersReport = me.getAura("Spymaster's Report");
        const spymastersStack = hasSpymastersReport ? hasSpymastersReport.stacks : 0;
        
        return (infernalRemains >= 10000 && 
                infernalRemains <= 20000 && 
                spymastersStack >= 38 && 
                (this.getFightRemains() > 240000 || this.getFightRemains() <= 140000)) || 
               this.getFightRemains() <= 30000;
      }),
      
      // Handle trinket slot 1
      Common.useEquippedItemByName("Trinket1", () => {
        if (!Settings.UseTrinkets) return false;
        
        // For simplified implementation, use with Infernal if talented
        return me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal");
      }),
      
      // Handle trinket slot 2
      Common.useEquippedItemByName("Trinket2", () => {
        if (!Settings.UseTrinkets) return false;
        
        // For simplified implementation, use with Infernal if talented
        return me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal");
      })
    );
  }

  /**
   * Use potion and racial abilities
   */
  useOGCDs() {
    return new bt.Selector("Use OGCDs",
      // Potion with Infernal
      new bt.Action(() => {
        // Would use potion here if implemented
        return bt.Status.Failure;
      }),
      
      // Racials if enabled
      new bt.Decorator(
        () => Settings.UseRacials,
        new bt.Selector(
          Spell.cast("Berserking", () => me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal")),
          Spell.cast("Blood Fury", () => me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal")),
          Spell.cast("Fireblood", () => me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal")),
          Spell.cast("Ancestral Call", () => me.hasAura("Infernal") || !Spell.isSpellKnown("Summon Infernal"))
        ),
        "Use Racial Abilities"
      )
    );
  }

  /**
   * Helper function to get the current target, preferring player's target if valid
   * @returns {CGUnit} The current target or null if none
   */
  getCurrentTarget() {
    const target = me.target;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  /**
   * Helper to check if an action is in flight to a target
   * @param {string} spellName - The name of the spell to check
   * @param {CGUnit} [target] - Optional target to check against
   * @returns {boolean} Whether the action is in flight
   */
  isActionInFlight(spellName, target = null) {
    // This is a simplified implementation since we don't have direct access to in_flight tracking
    // In a real implementation, we would check if the spell is being cast or in flight
    return false;
  }

  /**
   * Helper to get the remaining time on Havoc
   * @returns {number} The remaining time on Havoc in milliseconds
   */
  getHavocRemains() {
    // Find a target with Havoc
    let havocRemains = 0;
    
    combat.targets.forEach(target => {
      const havoc = target.getAuraByMe("Havoc");
      if (havoc && havoc.remaining > havocRemains) {
        havocRemains = havoc.remaining;
      }
    });
    
    return havocRemains;
  }

  /**
   * Check if Havoc is currently active on any target
   * @returns {boolean} Whether Havoc is active
   */
  isHavocActive() {
    return this.getHavocRemains() > 0;
  }

  /**
   * Get the number of valid enemies in range for AoE abilities
   * @param {number} [range=10] - The range to check for enemies (default is 10 yards for most AoE)
   * @returns {number} The number of valid enemies in range
   */
  getEnemyCount(range = 10) {
    // For Rain of Fire and other AoE spells, we typically want a smaller range
    let count = 0;
    const currentTarget = this.getCurrentTarget();
    
    if (!currentTarget) return 0;
    
    // Count enemies around the current target within range
    combat.targets.forEach(target => {
      if (target && !target.deadOrGhost && me.canAttack(target)) {
        // Check if the target is within range of the current target
        if (currentTarget.distanceTo(target) <= range) {
          count++;
        }
      }
    });
    
    // Debug log the enemy count for troubleshooting
    if (count > 1) {
      console.info(`AoE Detection: Found ${count} enemies within ${range} yards of target`);
    }
    
    return count;
  }

  /**
   * Get the count of active DoTs of the specified type
   * @param {string} dotName - The name of the DoT to check
   * @returns {number} The number of targets with the DoT active
   */
  getActiveDotCount(dotName) {
    let count = 0;
    
    combat.targets.forEach(target => {
      if (target.getAuraByMe(dotName)) {
        count++;
      }
    });
    
    return count;
  }

  /**
   * Get the best target for applying a DoT
   * @param {string} dotName - The name of the DoT to check
   * @returns {CGUnit|null} The best target or null if none found
   */
  getBestDotTarget(dotName) {
    let bestTarget = null;
    let lowestRemaining = 99999;
    
    combat.targets.forEach(target => {
      const dot = target.getAuraByMe(dotName);
      const dotRemains = dot ? dot.remaining : 0;
      const hasHavoc = target.hasAuraByMe("Havoc");
      
      // Prioritize targets without the DoT or with low remaining time
      // And give higher priority to Havoc targets
      if ((!dot || dot.refreshable) && target.timeToDeath() > 15) {
        if (hasHavoc) {
          if (bestTarget === null || dotRemains < lowestRemaining) {
            bestTarget = target;
            lowestRemaining = dotRemains;
          }
        } else if (!bestTarget || (bestTarget && !bestTarget.hasAuraByMe("Havoc") && dotRemains < lowestRemaining)) {
          bestTarget = target;
          lowestRemaining = dotRemains;
        }
      }
    });
    
    return bestTarget;
  }

  /**
   * Get the remaining time on Infernal
   * @returns {number} The remaining time on Infernal in milliseconds
   */
  getInfernalRemains() {
    const infernal = me.getAura("Infernal");
    return infernal ? infernal.remaining : 0;
  }

  /**
   * Check if we should pool soul shards
   * @returns {boolean} Whether to pool soul shards
   */
  getPoolingCondition() {
    // From SIMC: variable,name=pooling_condition,value=(soul_shard>=3|(talent.secrets_of_the_coven&buff.infernal_bolt.up|buff.decimation.up)&soul_shard>=3)
    return me.soul_shard >= 3 || 
           ((Spell.isSpellKnown("Secrets of the Coven") && me.hasAura("Infernal Bolt")) || 
            me.hasAura("Decimation")) && me.soul_shard >= 3;
  }

  /**
   * Check if we should pool soul shards for Chaos Bolt
   * @returns {boolean} Whether to pool soul shards for CB
   */
  getPoolingConditionCB() {
    // From SIMC: variable,name=pooling_condition_cb,value=variable.pooling_condition|pet.infernal.active&soul_shard>=3
    return this.getPoolingCondition() || (me.hasAura("Infernal") && me.soul_shard >= 3);
  }

  /**
   * Check if we are in cleave mode
   * @returns {boolean} Whether cleave mode is active
   */
  isCleaveModeActive() {
    // This is a placeholder for the cleave_apl variable in SIMC
    // In a real implementation, this would check the variable or setting
    return false;
  }

  /**
   * Check if we should use Rain of Fire for 2 targets
   * @returns {boolean} Whether to use RoF for 2T
   */
  allowRoF2TSpender() {
    return Settings.AllowRoF2TSpender || true;
  }

  /**
   * Check if we should disable Chaos Bolt for 2 targets
   * @returns {boolean} Whether to disable CB for 2T
   */
  shouldDisableCB2T() {
    return Settings.DisableCB2T || this.shouldDoRoF2T();
  }

  /**
   * Check if should use Rain of Fire for 2 targets
   * @returns {boolean} Whether to use RoF for 2T
   */
  shouldDoRoF2T() {
    // Log a detailed message showing what's influencing the decision
    const allowRoF = this.allowRoF2TSpender();
    const hasCataclysm = Spell.isSpellKnown("Cataclysm");
    const hasImprovedChaosBolt = Spell.isSpellKnown("Improved Chaos Bolt");
    
    const shouldUseRoF = allowRoF > 1.99 && !(hasCataclysm && hasImprovedChaosBolt);
    
    console.info(`Rain of Fire 2T Decision: allowRoF=${allowRoF}, hasCataclysm=${hasCataclysm}, hasImprovedCB=${hasImprovedChaosBolt}, decision=${shouldUseRoF}`);
    
    return shouldUseRoF;
  }

  /**
   * Get the estimated remaining time in the fight
   * @returns {number} The estimated fight remaining time in milliseconds
   */
  getFightRemains() {
    // This is a simplified implementation
    // In a real implementation, this would estimate based on boss health or other factors
    return 999999;
  }

  /**
   * Improved helper specifically for Rain of Fire decisions
   * @returns {boolean} Whether to use Rain of Fire
   */
shouldUseRainOfFire() {
    const enemyCount = this.getEnemyCount(8); // Standard AoE radius
    
    if (enemyCount >= 3) {
      return true;
    } else if (enemyCount === 2) {
      return this.shouldDoRoF2T();
    }
    
    return false;
  }  /**
   * Additional helper to improve AoE detection in Chaos Bolt vs. Rain of Fire decisions
   * @param {number} [range=8] - The range to check for enemies
   * @returns {boolean} Whether to use AoE abilities
   */
  shouldUseAoE(range = 8) {
    const enemyCount = this.getEnemyCount(range);
    
    // Log decision for debugging
    if (enemyCount > 1) {
      console.info(`AoE Decision: ${enemyCount} enemies found, using ${enemyCount >= 3 ? 'AoE' : (enemyCount === 2 ? 'Cleave' : 'ST')} rotation`);
    }
    
    return enemyCount >= 3;
  }
}
