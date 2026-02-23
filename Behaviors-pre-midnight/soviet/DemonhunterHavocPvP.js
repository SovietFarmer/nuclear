import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as Combat } from '@/Targeting/CombatTargeting';
import { PowerType } from '@/Enums/PowerType';
import { DispelPriority } from '@/Data/Dispels';
import { WoWDispelType } from '@/Enums/Auras';
import { pvpHelpers } from '@/Data/PVPData';
import { RaceType } from '@/Enums/UnitEnums';

const auras = {
  metamorphosis: 162264,
  immolationAura: 258920,
  unboundChaos: 347462,
  exergy: 208628, // The Hunt and Vengeful Retreat increase damage by 5% for 20 sec
  essenceBreak: 320338,
  warbladesHunger: 442503,
  reaversGlaive: 444686, // Correct aura ID found!
  thrillOfTheFight: 427717,
  glaiveFlurry: 442435,
  rendingStrike: 389978,
  initiative: 391215,
  blur: 212800,
  darkness: 209426,
  vengefulRetreat: 198793,
  felRush: 195072,
  sigilOfFlame: 204596,
  artOfTheGlaive: 444661,
  netherwalk: 196555,
  inertia: 427640,
};

export class DemonhunterHavocPvP extends Behavior {
  name = 'Demonhunter (Havoc) PvP';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Havoc PvP Settings',
      options: [
        {type: 'checkbox', uid: 'DHHavocUseOffensiveCooldown', text: 'Use Offensive Cooldowns', default: true},
        {type: 'checkbox', uid: 'DHHavocUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true},
        {type: 'slider', uid: 'DHHavocBlurThreshold', text: 'Blur HP Threshold', default: 65, min: 1, max: 100},
        {type: 'slider', uid: 'DHHavocDarknessThreshold', text: 'Darkness HP Threshold', default: 35, min: 1, max: 100},
        {
          type: 'slider',
          uid: 'DHHavocNetherwalkThreshold',
          text: 'Netherwalk HP Threshold',
          default: 20,
          min: 1,
          max: 100
        }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),

      // Interrupts (outside GCD)
      spell.interrupt('Disrupt', true),

      // CC abilities (outside GCD)
      spell.cast("Fel Eruption", on => this.felEruptionTarget(), ret => me.target && (me.target.effectiveHealthPercent < 87 || this.findFriendUsingMajorCDsWithin5Sec() !== undefined) && this.felEruptionTarget() !== undefined),
      spell.cast("Imprison", on => this.imprisonTarget(), ret => me.target && (me.target.effectiveHealthPercent < 75 || this.findFriendUsingMajorCDsWithin5Sec() !== undefined) && this.imprisonTarget() !== undefined),
      spell.cast("Sigil of Misery", on => this.sigilOfMiseryTarget(), ret => this.sigilOfMiseryTarget() !== undefined),

      common.waitForTarget(),
      common.waitForFacing(),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Defensive cooldowns (highest priority)
          this.defensiveCooldowns(),
          // Offensive dispels
          this.offensiveDispels(),
          // PvP burst or sustained damage
          new bt.Decorator(
            ret => Combat.burstToggle && me.target,
            this.burstDamage()
          ),
          this.miniBurst()
        )
      )
    );
  }


  offensiveDispels() {
    return new bt.Selector(
      // Consume Magic for enemy buffs (high priority)
      spell.dispel("Consume Magic", false, DispelPriority.Low, true, WoWDispelType.Magic),
      // Reverse Magic for friendly debuffs (medium priority)
      // spell.dispel("Reverse Magic", true, DispelPriority.Medium, true, WoWDispelType.Magic)
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      // Blur
      spell.cast('Blur', on => me, () =>
        me.effectiveHealthPercent <= Settings.DHHavocBlurThreshold &&
        Settings.DHHavocUseDefensiveCooldown),

      // Darkness
      spell.cast('Darkness', on => me, () =>
        me.effectiveHealthPercent <= Settings.DHHavocDarknessThreshold &&
        Settings.DHHavocUseDefensiveCooldown),

      // Netherwalk (emergency defensive)
      spell.cast('Netherwalk', on => me, () =>
        me.effectiveHealthPercent <= Settings.DHHavocNetherwalkThreshold &&
        Settings.DHHavocUseDefensiveCooldown)
    );
  }

  // PvP Burst Damage Sequence
  burstDamage() {
    return new bt.Decorator(
      ret => {
        // Burst when we have major cooldowns OR already in meta OR have decent fury
        const huntReady = spell.getCooldown('The Hunt').ready;
        const metaReady = spell.getCooldown('Metamorphosis').ready;
        const eyeBeamReady = spell.getCooldown('Eye Beam').ready;
        const fury = this.getFury();
        const metaActive = me.hasAura(auras.metamorphosis);

        return huntReady || metaReady || metaActive || eyeBeamReady || fury > 60;
      },
      this.burstSequence()
    );
  }

  burstSequence() {
    return new bt.Selector(
      // Use racials during burst
      this.useRacials(),

      // Burst sequence - tree will traverse down when spells are on cooldown
      // Throw glaive
      spell.cast("Throw Glaive", on => me.target, ret => me.hasAura(auras.reaversGlaive)),
      // The Hunt to proc Reaver's Glaive and Exergy buff - check for root status
      spell.cast("The Hunt", on => me.target, ret => !me.isRooted()),
      // Eye Beam to enter Demon Form (prioritize when we have Reaver's Glaive)
      spell.cast("Eye Beam", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Chaos Strike when empowered by warbladesHunger
      spell.cast("Chaos Strike", on => me.target, ret => me.hasAura(auras.warbladesHunger)),
      // Felblade for fury and positioning
      spell.cast("Felblade", on => me.target, ret => true),
      // Essence Break to empower abilities
      spell.cast("Essence Break", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Blade Dance within Essence Break window
      spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target) && this.getDebuffRemainingTime("Essence Break") > 0),
      // Metamorphosis if not already active
      spell.cast("Metamorphosis", on => me.target, ret => Settings.DHHavocUseOffensiveCooldown && !me.hasAura(auras.metamorphosis)),
      // Immolation Aura when fury is low
      spell.cast("Immolation Aura", on => me, ret => this.getFury() < 60),
      // Blade Dance (bot handles Death Sweep upgrade during meta)
      spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Chaos Strike (bot handles Annihilation upgrade during meta)
      spell.cast("Chaos Strike", on => me.target),
      // Sigil of Spite for soul generation when we need it
      spell.cast("Sigil of Spite", on => me.target, ret => this.getSoulFragments() < 3),
      // miniBurst()
      this.miniBurst()
    );
  }

  // Mini-Burst (When Hunt/Meta are on CD)
  miniBurst() {
    return new bt.Selector(
      // Use Sigil of Spite if you have at least 2 souls to proc Reaver's Glaive Icon Reaver's Glaive if needed.
      spell.cast("Sigil of Spite", on => me.target, ret => this.getSoulFragments() >= 2),
      // Use Reaver's Glaive to empower Chaos Strike Icon Chaos Strike and Blade Dance Icon Blade Dance.
      spell.cast("Throw Glaive", on => me.target, ret => me.hasAura(auras.reaversGlaive)),
      // Use Vengeful Retreat to proc Inertia.
      // Use Fel Blade to activate Inertia and buff our damage by 18%.
      spell.cast("Felblade", on => me.target, ret => !me.hasAura(auras.inertia)),
      // Use Eye Beam to enter Demon Form.
      spell.cast("Eye Beam", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Use Essence Break.
      spell.cast("Essence Break", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Use Annihilation.
      spell.cast("Annihilation", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // Use Death Sweep.
      spell.cast("Death Sweep", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      // SustainedDamage()
      this.sustainedDamage()
    );
  }

  // Sustained Damage - priorities from the guide, behavior tree will traverse when spells fail
  sustainedDamage() {
    return new bt.Selector(
      // Throw Glaive when empowered by Reaver's Glaive - highest priority
      spell.cast("Throw Glaive", on => me.target, ret => me.hasAura(auras.reaversGlaive)),
      // Felblade to catch up to target when out of melee but within 15 yards
      spell.cast("Felblade", on => me.target, ret => !me.isWithinMeleeRange(me.target) && me.target.distanceTo(me) <= 15),
      // Ranged abilities when not in melee and too far for Felblade
      new bt.Decorator(ret => !me.isWithinMeleeRange(me.target) && me.isFacing(me.target),
        new bt.Selector(spell.cast("Throw Glaive", on => me.target, req => spell.getCharges('Throw Glaive') === 2)
        )),
      // Melee rotation - sustained damage priorities from guide
      new bt.Decorator(ret => me.isWithinMeleeRange(me.target) && me.isFacing(me.target),
        new bt.Selector(
          // Blade Dance - highest priority (empowered by Reaver's Glaive when available)
          spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),
          // Chaos Strike if we have Fury (empowered by Reaver's Glaive when available)
          spell.cast("Chaos Strike", on => me.target, ret => this.getFury() >= 40),
          // Felblade for Fury generation - use as often as possible for Army Unto Oneself uptime
          spell.cast("Felblade", on => me.target, ret => this.getFury() < 90),
          // Immolation Aura - lowest priority generator
          spell.cast("Immolation Aura", on => me),
          // Sigil of Spite for soul generation when we need it
          spell.cast("Sigil of Spite", on => me.target, ret => this.getSoulFragments() < 3),
          // Throw Glaive as a slow when target isn't slowed
          //spell.cast("Throw Glaive", on => me.target, ret => me.target && (me.target.isRooted() || !me.target.isMoving())),
          // Demon's Bite as absolute filler
          spell.cast("Demon's Bite", on => me.target)
        ))
    );
  }

  getFury() {
    return me.powerByType(PowerType.Fury);
  }

  getSoulFragments() {
    return me.soulFragments || 0;
  }

  getDebuffRemainingTime(debuffName) {
    if (!me.target) return 0;
    const debuff = me.target.getAura(debuffName);
    return debuff ? debuff.remaining : 0;
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  // CC targeting methods
  felEruptionTarget() {
    // Get all enemy players within 30 yards and find the first valid healer target for stun
    const nearbyEnemies = me.getPlayerEnemies(20);

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && me.isFacing(unit) && !unit.isCCd() && unit.canCC() && unit.getDR("stun") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  imprisonTarget() {
    // Get all enemy players within 30 yards and find the first valid healer target for incapacitate
    const nearbyEnemies = me.getPlayerEnemies(20);

    for (const unit of nearbyEnemies) {
      if (unit !== me.target && unit.isHealer() && me.isFacing(unit) && !unit.isCCd() && unit.canCC() && unit.getDR("incapacitate") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  sigilOfMiseryTarget() {
    // Get all enemy players within 20 yards and find healers that are stunned/rooted with 0 disorient DR
    const nearbyEnemies = me.getPlayerEnemies(30);

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && (unit.isStunned() || unit.isRooted()) && unit.canCC() && unit.getDR("disorient") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  // Helper function to find friends using major cooldowns
  findFriendUsingMajorCDsWithin5Sec() {
    const friends = me.getPlayerFriends(40);
    let bestTarget = null;
    let bestPriority = 0;

    for (const friend of friends) {
      if (!me.withinLineOfSight(friend)) {
        continue;
      }

      const majorCooldown = pvpHelpers.hasMajorDamageCooldown(friend, 5);
      if (!majorCooldown) {
        continue;
      }

      // Calculate priority based on class role and cooldown duration
      let priority = 0;

      // Higher priority for DPS classes
      if (!friend.isHealer()) {
        priority += 100;
      } else {
        priority += 50; // Support healers too, but lower priority
      }

      // Bonus for longer duration cooldowns
      if (majorCooldown.remainingTime > 8) {
        priority += 50;
      } else if (majorCooldown.remainingTime > 5) {
        priority += 25;
      }

      // Check if they have multiple major cooldowns (even better target)
      const allMajorCDs = this.countMajorCooldowns(friend);
      if (allMajorCDs > 1) {
        priority += 25 * (allMajorCDs - 1);
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestTarget = friend;
      }
    }

    if (bestTarget) {
      const majorCooldown = pvpHelpers.hasMajorDamageCooldown(bestTarget, 3);
      console.log(`[DH] Friend with major CD found: ${bestTarget.unsafeName} with ${majorCooldown.name} (${majorCooldown.remainingTime.toFixed(1)}s remaining)`);
    }

    return bestTarget;
  }

  countMajorCooldowns(unit) {
    let count = 0;
    // This is a simplified count - you could enhance this to check for specific buff combinations
    if (pvpHelpers.hasMajorDamageCooldown(unit, 5)) {
      count++;
      // You could add more specific checks here for different types of cooldowns
    }
    return count;
  }

  // Racial abilities
  useRacials() {
    return new bt.Selector(
      spell.cast("Arcane Torrent", ret => me.race === RaceType.BloodElf && Combat.burstToggle),
    );
  }
}
