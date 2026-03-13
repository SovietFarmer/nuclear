import { Behavior, BehaviorContext } from '@/Core/Behavior';
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from '@/Core/Spell';
import Settings from '@/Core/Settings';
import { me } from '@/Core/ObjectManager';
import { defaultCombatTargeting as Combat } from '@/Targeting/CombatTargeting';
import { PowerType } from '@/Enums/PowerType';
import { RaceType } from '@/Enums/UnitEnums';

const auras = {
  metamorphosis: 162264,
  unboundChaos: 347462,
  inertia: 427640,
  blur: 212800,
  darkness: 209426,
};

export class DemonhunterHavoc extends Behavior {
  name = 'Demonhunter Havoc Fel-Scarred';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Havoc Fel-Scarred Settings',
      options: [
        {type: 'checkbox', uid: 'DHHavocUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true},
        {type: 'slider', uid: 'DHHavocBlurThreshold', text: 'Blur HP Threshold', default: 65, min: 1, max: 100},
        {type: 'slider', uid: 'DHHavocDarknessThreshold', text: 'Darkness HP Threshold', default: 35, min: 1, max: 100},
        {type: 'checkbox', uid: 'DHHavocUseVengefulRetreat', text: 'Use Vengeful Retreat (Inertia)', default: false},
        {type: 'checkbox', uid: 'DHHavocUseFelRush', text: 'Use Fel Rush (Inertia / Filler)', default: false},
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),

      spell.interrupt('Disrupt'),

      common.waitForTarget(),
      common.waitForFacing(),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.defensiveCooldowns(),
          common.waitForCombat(),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstCooldowns()
          ),
          this.mainRotation()
        )
      )
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast('Blur', on => me, ret =>
        me.effectiveHealthPercent <= Settings.DHHavocBlurThreshold &&
        Settings.DHHavocUseDefensiveCooldown),

      spell.cast('Darkness', on => me, ret =>
        me.effectiveHealthPercent <= Settings.DHHavocDarknessThreshold &&
        Settings.DHHavocUseDefensiveCooldown),
    );
  }

  hasCooldownsReady() {
    if (!Combat.burstToggle || !me.isWithinMeleeRange(me.target)) return false;
    if (spell.isSpellKnown("Metamorphosis") && !spell.isOnCooldown("Metamorphosis")) return true;
    if (spell.isSpellKnown("The Hunt") && !spell.isOnCooldown("The Hunt")) return true;
    return false;
  }

  burstCooldowns() {
    return new bt.Selector(
      this.useRacials(),

      spell.cast("The Hunt", on => me.target, ret => !me.isRooted()),

      // Meta after Eye Beam — Chaotic Transformation resets Eye Beam + Death Sweep CDs
      spell.cast("Metamorphosis", on => me, ret =>
        !me.hasAura(auras.metamorphosis) &&
        spell.isOnCooldown('Eye Beam')),
    );
  }

  mainRotation() {
    return new bt.Selector(
      // Proc Inertia: Felblade / Fel Rush when Unbound Chaos is up from Vengeful Retreat
      spell.cast("Felblade", on => me.target, ret => me.hasAura(auras.unboundChaos)),
      spell.cast("Fel Rush", on => me, ret =>
        Settings.DHHavocUseFelRush && me.hasAura(auras.unboundChaos)),

      // Death Sweep (Blade Dance override in Meta) — spend Demonsurge empowerments first
      spell.cast("Death Sweep", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),
      spell.cast("Blade Dance", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),

      // AoE: Immolation Aura when capped on charges at 2+ targets
      spell.cast("Immolation Aura", on => me, ret =>
        Combat.targets.length >= 2 && spell.getCharges("Immolation Aura") >= 2),

      // Vengeful Retreat to setup Inertia window before Eye Beam
      spell.cast("Vengeful Retreat", on => me, ret =>
        Settings.DHHavocUseVengefulRetreat &&
        spell.getCooldown("Eye Beam").ready && !me.hasAura(auras.inertia)),

      // Eye Beam — enters demon form via Demonic, triggers Demonsurge
      spell.cast("Eye Beam", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      // Essence Break while in Metamorphosis for damage amp
      spell.cast("Essence Break", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) && me.isWithinMeleeRange(me.target)),

      // Blade Dance outside Meta
      spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      // Annihilation (Chaos Strike override in Meta)
      spell.cast("Annihilation", on => me.target, ret => me.hasAura(auras.metamorphosis)),
      spell.cast("Chaos Strike", on => me.target, ret => me.hasAura(auras.metamorphosis)),

      // Chaos Strike filler
      spell.cast("Chaos Strike", on => me.target),

      // Immolation Aura
      spell.cast("Immolation Aura", on => me),

      // Felblade for Fury generation
      spell.cast("Felblade", on => me.target),

      // Fillers when nothing else is available
      spell.cast("Throw Glaive", on => me.target),
      spell.cast("Fel Rush", on => me, ret =>
        Settings.DHHavocUseFelRush && me.isWithinMeleeRange(me.target)),
    );
  }

  getFury() {
    return me.powerByType(PowerType.Fury);
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Arcane Torrent", ret => me.race === RaceType.BloodElf && Combat.burstToggle),
    );
  }
}
