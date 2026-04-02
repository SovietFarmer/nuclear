import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as Combat } from '@/Targeting/CombatTargeting';
import { PowerType } from '@/Enums/PowerType';
import { DispelPriority, dispels } from '@/Data/Dispels';
import { WoWDispelType } from '@/Enums/Auras';
import { pvpHelpers } from '@/Data/PVPData';
const auras = {
  metamorphosis: 162264,
  immolationAura: 258920,
  unboundChaos: 347462,
  exergy: 208628,
  warbladesHunger: 442503,
  reaversGlaive: 444686,
  thrillOfTheFight: 427717,
  glaiveFlurry: 442435,
  rendingStrike: 389978,
  initiative: 391215,
  blur: 212800,
  darkness: 209426,
  vengefulRetreat: 198793,
  felRush: 195072,
  inertia: 427640,
};

export class DemonhunterHavocPvP extends Behavior {
  name = 'Havoc Demon Hunter PvP Fel-Scarred (Midnight)';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Havoc Fel-Scarred PvP (Midnight)',
      options: [
        { type: 'checkbox', uid: 'DHHavocUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true },
        { type: 'slider', uid: 'DHHavocBlurThreshold', text: 'Blur HP Threshold', default: 65, min: 1, max: 100 },
        { type: 'slider', uid: 'DHHavocDarknessThreshold', text: 'Darkness HP Threshold', default: 35, min: 1, max: 100 },
        { type: 'checkbox', uid: 'DHHavocUseVengefulRetreat', text: 'Use Vengeful Retreat', default: false },
        { type: 'checkbox', uid: 'DHHavocUseFelRush', text: 'Use Fel Rush', default: false },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),

      spell.interrupt('Disrupt', true),

      // CC outside GCD gate — highest priority when conditions are met
      spell.cast("Chaos Nova", on => me, ret => this.shouldChaosNova()),
      spell.cast("Imprison",
        on => this.imprisonTarget(),
        ret => me.target &&
          (me.target.effectiveHealthPercent < 75 || this.findFriendUsingMajorCDsWithin5Sec()) &&
          this.imprisonTarget() !== undefined),
      spell.cast("Sigil of Misery",
        on => this.sigilOfMiseryTarget(),
        ret => this.sigilOfMiseryTarget() !== undefined),

      common.waitForTarget(),
      common.waitForFacing(),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.defensiveCooldowns(),
          common.waitForNotWaitingForArenaToStart(),
          common.waitForCombat(),
          this.offensiveDispels(),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstCooldowns()
          ),
          this.sustainedDamage()
        )
      )
    );
  }

  offensiveDispels() {
    return new bt.Selector(
      spell.cast("Arcane Torrent", on => me, ret =>
        spell.isSpellKnown("Arcane Torrent") && this.hasOffensiveDispelTargetInMelee()),
      spell.dispel("Consume Magic", false, DispelPriority.Low, true, WoWDispelType.Magic),
    );
  }

  /** Same purge rules as spell.dispel (enemy magic buffs); true if a player we would purge is in melee range. */
  hasOffensiveDispelTargetInMelee() {
    if (Settings.DispelMode === "None") return false;
    const priority = DispelPriority.Low;

    for (const unit of Combat.targets) {
      if (!unit.isPlayer()) continue;
      if (!me.isWithinMeleeRange(unit) || !me.withinLineOfSight(unit)) continue;

      for (const aura of unit.auras) {
        const dispelTypeMatch = aura.dispelType === WoWDispelType.Magic;
        const dispelPriority = dispels[aura.spellId] || DispelPriority.Low;
        const isValidDispel = aura.isBuff() && dispelPriority >= priority;

        if (isValidDispel && aura.remaining > 2000 && dispelTypeMatch) {
          const durationPassed = aura.duration - aura.remaining;
          let shouldDispel = false;
          if (Settings.DispelMode === "Everything") {
            shouldDispel = true;
          } else if (Settings.DispelMode === "List") {
            shouldDispel = dispels[aura.spellId] !== undefined;
          }
          if (shouldDispel && durationPassed > 777) {
            return true;
          }
        }
      }
    }
    return false;
  }

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast('Blur', on => me, ret =>
        !me.hasAura(auras.blur) &&
        me.effectiveHealthPercent <= Settings.DHHavocBlurThreshold &&
        Settings.DHHavocUseDefensiveCooldown),

      spell.cast('Darkness', on => me, ret =>
        me.effectiveHealthPercent <= Settings.DHHavocDarknessThreshold &&
        Settings.DHHavocUseDefensiveCooldown),
    );
  }

  hasCooldownsReady() {
    if (!Combat.burstToggle || !me.target || !me.isWithinMeleeRange(me.target)) return false;
    if (spell.isSpellKnown("The Hunt") && !spell.isOnCooldown("The Hunt")) return true;
    if (spell.isSpellKnown("Metamorphosis") && !spell.isOnCooldown("Metamorphosis")) return true;
    return false;
  }

  // Fel-Scarred burst: Immolation → The Hunt → Eye Beam → Annihilation/Death Sweep → Meta → Sigil → spenders → Consuming Fire / Abyssal Gaze
  burstCooldowns() {
    return new bt.Selector(
      spell.cast("Immolation Aura", on => me),
      spell.cast("The Hunt", on => me.target, ret => !me.isRooted()),
      spell.cast("Eye Beam", on => me.target, ret =>
        !me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
      spell.cast("Annihilation", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
      spell.cast("Death Sweep", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
      spell.cast("Metamorphosis", on => me, ret => !me.hasAura(auras.metamorphosis)),
      spell.cast("Sigil of Doom", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Sigil of Doom")),
      spell.cast("Consuming Fire", on => me, ret =>
        me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Consuming Fire")),
      spell.cast("Abyssal Gaze", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Abyssal Gaze") && me.isWithinMeleeRange(me.target)),
      spell.cast("Felblade", on => me.target),
      spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      spell.cast("Chaos Strike", on => me.target, ret => this.getFury() >= 40),
    );
  }

  sustainedDamage() {
    return new bt.Selector(
      // Felblade gap-close when out of melee but within 15yd
      spell.cast("Felblade", on => me.target, ret =>
        !me.isWithinMeleeRange(me.target) && me.target.distanceTo(me) <= 15),
      // Ranged Throw Glaive when out of melee and capped on charges
      new bt.Decorator(
        ret => !me.isWithinMeleeRange(me.target) && me.isFacing(me.target),
        new bt.Selector(
          spell.cast("Throw Glaive", on => me.target, ret => spell.getCharges("Throw Glaive") >= 2)
        )),
      // Melee rotation (aligned with PvE Fel-Scarred: Unbound Chaos → Meta spenders → Eye Beam → extensions)
      new bt.Decorator(
        ret => me.isWithinMeleeRange(me.target) && me.isFacing(me.target),
        new bt.Selector(
          spell.cast("Felblade", on => me.target, ret => me.hasAura(auras.unboundChaos)),
          spell.cast("Fel Rush", on => me, ret =>
            Settings.DHHavocUseFelRush && me.hasAura(auras.unboundChaos)),
          spell.cast("Death Sweep", on => me.target, ret =>
            me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
          spell.cast("Blade Dance", on => me.target, ret =>
            me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
          spell.cast("Immolation Aura", on => me, ret =>
            Combat.targets.length >= 2 && spell.getCharges("Immolation Aura") >= 2),
          spell.cast("Vengeful Retreat", on => me, ret =>
            Settings.DHHavocUseVengefulRetreat &&
            spell.getCooldown("Eye Beam").ready &&
            !me.hasAura(auras.inertia)),
          spell.cast("Eye Beam", on => me.target),
          spell.cast("Essence Break", on => me.target, ret =>
            me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Essence Break") && me.isWithinMeleeRange(me.target)),
          spell.cast("Sigil of Doom", on => me.target, ret =>
            me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Sigil of Doom")),
          spell.cast("Consuming Fire", on => me, ret =>
            me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Consuming Fire")),
          spell.cast("Abyssal Gaze", on => me.target, ret =>
            me.hasAura(auras.metamorphosis) && spell.isSpellKnown("Abyssal Gaze") && me.isWithinMeleeRange(me.target)),
          spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),
          spell.cast("Annihilation", on => me.target, ret => me.hasAura(auras.metamorphosis)),
          spell.cast("Chaos Strike", on => me.target, ret => me.hasAura(auras.metamorphosis)),
          spell.cast("Chaos Strike", on => me.target, ret => this.getFury() >= 40),
          spell.cast("Felblade", on => me.target, ret => this.getFury() < 90),
          spell.cast("Immolation Aura", on => me),
          spell.cast("Fel Rush", on => me, ret =>
            Settings.DHHavocUseFelRush && me.isWithinMeleeRange(me.target)),
          spell.cast("Throw Glaive", on => me.target),
        )),
    );
  }

  getFury() {
    return me.powerByType(PowerType.Fury);
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  // Chaos Nova 8yd PBAoE stun — replaces Fel Eruption (removed in Midnight)
  // 3s base, 5s on priority target via Focused Ire
  shouldChaosNova() {
    if (!me.target) return false;
    if (spell.getTimeSinceLastCast("Chaos Nova") < 2000) return false;
    if (me.target.effectiveHealthPercent >= 87 && !this.findFriendUsingMajorCDsWithin5Sec()) return false;

    const nearbyEnemies = me.getPlayerEnemies(8);
    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && !unit.isCCd() && unit.canCC() && unit.getDR("stun") === 0) {
        return true;
      }
    }
    return false;
  }

  imprisonTarget() {
    const nearbyEnemies = me.getPlayerEnemies(20);
    for (const unit of nearbyEnemies) {
      if (unit !== me.target && unit.isHealer() && me.isFacing(unit) &&
        !unit.isCCd() && unit.canCC() && unit.getDR("incapacitate") === 0) {
        return unit;
      }
    }
    return undefined;
  }

  sigilOfMiseryTarget() {
    const nearbyEnemies = me.getPlayerEnemies(30);
    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && (unit.isStunned() || unit.isRooted()) &&
        unit.canCC() && unit.getDR("disorient") === 0) {
        return unit;
      }
    }
    return undefined;
  }

  findFriendUsingMajorCDsWithin5Sec() {
    const friends = me.getPlayerFriends(40);
    let bestTarget = null;
    let bestPriority = 0;

    for (const friend of friends) {
      if (!me.withinLineOfSight(friend)) continue;

      const majorCooldown = pvpHelpers.hasMajorDamageCooldown(friend, 5);
      if (!majorCooldown) continue;

      let priority = 0;
      if (!friend.isHealer()) {
        priority += 100;
      } else {
        priority += 50;
      }

      if (majorCooldown.remainingTime > 8) {
        priority += 50;
      } else if (majorCooldown.remainingTime > 5) {
        priority += 25;
      }

      const allMajorCDs = this.countMajorCooldowns(friend);
      if (allMajorCDs > 1) {
        priority += 25 * (allMajorCDs - 1);
      }

      if (priority > bestPriority) {
        bestPriority = priority;
        bestTarget = friend;
      }
    }

    return bestTarget;
  }

  countMajorCooldowns(unit) {
    let count = 0;
    if (pvpHelpers.hasMajorDamageCooldown(unit, 5)) {
      count++;
    }
    return count;
  }

}
