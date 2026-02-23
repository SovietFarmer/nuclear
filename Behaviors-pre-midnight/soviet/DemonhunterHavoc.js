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
  immolationAura: 258920,
  unboundChaos: 347462,
  exergy: 208628, // The Hunt and Vengeful Retreat increase damage by 5% for 20 sec
  essenceBreak: 320338,
  warbladesHunger: 442503,
  reaversGlaive: 444686,
  thrillOfTheFight: 427717,
  glaiveFlurry: 442435,
  rendingStrike: 442442, // Added missing aura
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

export class DemonhunterHavoc extends Behavior {
  name = 'Demonhunter (Havoc) PVE';
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: 'Havoc PvE Settings',
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
      spell.interrupt('Disrupt'),

      common.waitForTarget(),
      common.waitForFacing(),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          // Defensive cooldowns (highest priority)
          this.defensiveCooldowns(),
          // Burst damage when conditions are met
          new bt.Decorator(
            ret => Combat.burstToggle && me.target,
            this.burstDamage()
          ),
          // Sustained damage rotation
          this.sustainedDamage()
        )
      )
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

  // Burst Damage Sequence
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

      // Throw glaive when empowered by Reaver's Glaive
      spell.cast("Throw Glaive", on => me.target, ret => me.hasAura(auras.reaversGlaive)),

      // The Hunt to proc Reaver's Glaive and Exergy buff
      spell.cast("The Hunt", on => me.target, ret => !me.isRooted()),

      // Eye Beam to enter Demon Form
      spell.cast("Eye Beam", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      // Chaos Strike when empowered by warbladesHunger
      spell.cast("Chaos Strike", on => me.target, ret => me.hasAura(auras.warbladesHunger)),

      // Felblade for fury and positioning
      spell.cast("Felblade", on => me.target, ret => true),

      // Essence Break to empower abilities
      spell.cast("Essence Break", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      // Blade Dance within Essence Break window
      spell.cast("Blade Dance", on => me.target, ret =>
        me.isWithinMeleeRange(me.target) && this.getDebuffRemainingTime("Essence Break") > 0),

      // Metamorphosis if not already active
      spell.cast("Metamorphosis", on => me.target, ret =>
        Settings.DHHavocUseOffensiveCooldown && !me.hasAura(auras.metamorphosis)),

      // Immolation Aura when fury is low
      spell.cast("Immolation Aura", on => me, ret => this.getFury() < 60),

      // Blade Dance (bot handles Death Sweep upgrade during meta)
      spell.cast("Blade Dance", on => me.target, ret => me.isWithinMeleeRange(me.target)),

      // Chaos Strike (bot handles Annihilation upgrade during meta)
      spell.cast("Chaos Strike", on => me.target),

      // Sigil of Spite for soul generation when we need it
      spell.cast("Sigil of Spite", on => me.target, ret => this.getSoulFragments() < 3),

      // Fall back to sustained damage
      this.sustainedDamage()
    );
  }

  // Sustained damage rotation based on the updated priority sequence
  sustainedDamage() {
    return new bt.Selector(
      // Cast Death Sweep (Blade Dance) during Essence Break
      spell.cast("Blade Dance", on => me.target, ret =>
        me.isWithinMeleeRange(me.target) &&
        me.hasAura(auras.metamorphosis) &&
        this.getDebuffRemainingTime("Essence Break") > 0),

      // Cast Annihilation (Chaos Strike) during Essence Break
      spell.cast("Chaos Strike", on => me.target, ret =>
        me.hasAura(auras.metamorphosis) &&
        this.getDebuffRemainingTime("Essence Break") > 0),

      // Cast Reaver's Glaive unless Thrill of the Fight is up with 3+ seconds OR either Glaive Flurry or Rending Strike still need to be used
      spell.cast("Throw Glaive", on => me.target, ret =>
        me.hasAura(auras.reaversGlaive) &&
        !(me.hasAura(auras.thrillOfTheFight) && this.getAuraRemainingTime(auras.thrillOfTheFight) > 3000) &&
        !me.hasAura(auras.glaiveFlurry) &&
        !me.hasAura(auras.rendingStrike)),

      // Cast Sigil of Spite
      spell.cast("Sigil of Spite", on => me.target),


      // Cast The Hunt if you do NOT have a Reaver's Glaive charge ready
      spell.cast("The Hunt", on => me.target, ret =>
        !me.hasAura(auras.reaversGlaive) && !me.isRooted()),

      // Cast Essence Break while in Metamorphosis
      spell.cast("Essence Break", on => me.target, ret =>
        me.isWithinMeleeRange(me.target) &&
        me.hasAura(auras.metamorphosis)),

      // Cast Death Sweep (Blade Dance)
      spell.cast("Blade Dance", on => me.target, ret =>
        me.isWithinMeleeRange(me.target) &&
        me.hasAura(auras.metamorphosis)),

      // Cast Metamorphosis if Eye Beam is on cooldown
      spell.cast("Metamorphosis", on => me.target, ret =>
        Settings.DHHavocUseOffensiveCooldown &&
        !me.hasAura(auras.metamorphosis) &&
        spell.isOnCooldown('Eye Beam')),

      // Cast Eye Beam
      spell.cast("Eye Beam", on => me.target, ret =>
        me.isWithinMeleeRange(me.target)),

      // Cast Blade Dance
      spell.cast("Blade Dance", on => me.target, ret =>
        me.isWithinMeleeRange(me.target)),

      // Cast Sigil of Flame if under 90 Fury
      spell.cast("Sigil of Flame", on => me.target, ret =>
        this.getFury() < 90),

      // Cast Annihilation (Chaos Strike)
      spell.cast("Chaos Strike", on => me.target, ret =>
        me.hasAura(auras.metamorphosis)),

      // Cast Felblade if under 60 Fury
      spell.cast("Felblade", on => me.target, ret =>
        this.getFury() < 60),

      // Cast Chaos Strike
      spell.cast("Chaos Strike", on => me.target),

      // Cast Immolation Aura
      spell.cast("Immolation Aura", on => me),

      // Cast Throw Glaive or Fel Rush if no other abilities are available
      spell.cast("Throw Glaive", on => me.target, ret =>
        !me.isWithinMeleeRange(me.target) || spell.getCharges('Throw Glaive') === 2),


      // Demon's Bite as absolute filler
      spell.cast("Demon's Bite", on => me.target)
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

  // Racial abilities
  useRacials() {
    return new bt.Selector(
      spell.cast("Arcane Torrent", ret => me.race === RaceType.BloodElf && Combat.burstToggle),
    );
  }
}
