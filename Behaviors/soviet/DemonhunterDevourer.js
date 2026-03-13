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
  voidMetamorphosis: 1217607,
  shatteredSouls: 1227619,
  voidfall: 1256301,
  momentOfCraving: 1238495,
  soulGlutton: 1247534,
  blur: 212800,
  darkness: 209426,
};

export class DemonhunterDevourer extends Behavior {
  name = 'Demonhunter Devourer Annihilator';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Devourer;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Devourer Annihilator Settings',
      options: [
        {type: 'checkbox', uid: 'DHDevourerUseDefensiveCooldown', text: 'Use Defensive Cooldowns', default: true},
        {type: 'slider', uid: 'DHDevourerBlurThreshold', text: 'Blur HP Threshold', default: 65, min: 1, max: 100},
        {type: 'slider', uid: 'DHDevourerDarknessThreshold', text: 'Darkness HP Threshold', default: 35, min: 1, max: 100},
        {type: 'checkbox', uid: 'DHDevourerUseVengefulRetreat', text: 'Use Vengeful Retreat (Melee Combo)', default: false},
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
          new bt.Decorator(
            ret => me.hasAura(auras.voidMetamorphosis),
            this.voidMetaRotation()
          ),
          this.mainRotation()
        )
      )
    );
  }

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast('Blur', on => me, ret =>
        me.effectiveHealthPercent <= Settings.DHDevourerBlurThreshold &&
        Settings.DHDevourerUseDefensiveCooldown),

      spell.cast('Darkness', on => me, ret =>
        me.effectiveHealthPercent <= Settings.DHDevourerDarknessThreshold &&
        Settings.DHDevourerUseDefensiveCooldown),
    );
  }

  hasCooldownsReady() {
    if (!Combat.burstToggle) return false;
    if (spell.isSpellKnown("Void Metamorphosis") &&
      !me.hasAura(auras.voidMetamorphosis) &&
      !spell.isOnCooldown("Void Metamorphosis")) return true;
    if (spell.isSpellKnown("The Hunt") && !spell.isOnCooldown("The Hunt")) return true;
    return false;
  }

  burstCooldowns() {
    return new bt.Selector(
      this.useRacials(),

      // Pre-Meta: consume Voidfall stacks with Voidblade before entering Void Metamorphosis
      spell.cast("Pierce the Veil", on => me.target, ret =>
        !me.hasAura(auras.voidMetamorphosis) &&
        me.hasAura(auras.voidfall) &&
        me.isWithinMeleeRange(me.target)),
      spell.cast("Voidblade", on => me.target, ret =>
        !me.hasAura(auras.voidMetamorphosis) &&
        me.hasAura(auras.voidfall) &&
        me.isWithinMeleeRange(me.target)),

      // The Hunt before Meta — CD resets on Meta entry via Violent Transformation
      spell.cast("Predator's Wake", on => me.target, ret => !me.isRooted()),
      spell.cast("The Hunt", on => me.target, ret => !me.isRooted()),

      spell.cast("Void Metamorphosis", on => me, ret =>
        !me.hasAura(auras.voidMetamorphosis)),
    );
  }

  // Upgraded abilities inside Void Metamorphosis with completely different priorities
  voidMetaRotation() {
    return new bt.Selector(
      this.meleeCombo(),

      // AoE: Eradicate at 2+ targets
      spell.cast("Eradicate", on => me.target, ret => Combat.targets.length >= 2),

      // Void Ray — upgraded: free, pauses Fury drain, on 14s hasted CD
      spell.cast("Void Ray", on => me.target),

      // Collapsing Star — requires 30 fragments collected during Meta (game enforces via isUsable)
      spell.cast("Collapsing Star", on => me.target),

      // Cull (Reap override) when Voidfall/Moment of Craving proc is active
      spell.cast("Cull", on => me.target, ret =>
        me.hasAura(auras.voidfall) || me.hasAura(auras.momentOfCraving)),
      spell.cast("Reap", on => me.target, ret =>
        me.hasAura(auras.voidfall) || me.hasAura(auras.momentOfCraving)),

      // Devour (Consume override) — unconditional filler
      spell.cast("Devour", on => me.target),
      spell.cast("Consume", on => me.target),
    );
  }

  // Outside Void Metamorphosis — ramp soul fragments toward next Meta window
  mainRotation() {
    return new bt.Selector(
      this.meleeCombo(),

      // AoE: Eradicate at 2+ targets
      spell.cast("Eradicate", on => me.target, ret => Combat.targets.length >= 2),

      // Void Ray — primary ranged nuke
      spell.cast("Void Ray", on => me.target),

      // Reap when Voidfall or Moment of Craving proc — don't waste empowered casts
      spell.cast("Reap", on => me.target, ret =>
        me.hasAura(auras.voidfall) || me.hasAura(auras.momentOfCraving)),

      // Consume — unconditional filler, generates soul fragments
      spell.cast("Consume", on => me.target),
    );
  }

  // Annihilator melee combo: Voidblade → Hungering Slash → free Vengeful Retreat → repeat
  meleeCombo() {
    return new bt.Selector(
      spell.cast("Pierce the Veil", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      spell.cast("Voidblade", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      spell.cast("Reaper's Toll", on => me.target, ret => me.isWithinMeleeRange(me.target)),
      spell.cast("Hungering Slash", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      spell.cast("Vengeful Retreat", on => me, ret => Settings.DHDevourerUseVengefulRetreat),
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
