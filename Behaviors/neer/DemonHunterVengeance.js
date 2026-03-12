import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from '@/Core/Settings';
import KeyBinding from '@/Core/KeyBinding';

const auras = {
  soulFragments: 203981,
  demonSpikes: 203819,
  fieryBrand: 207771,
  metamorphosis: 187827,
};

export class DemonHunterVengeanceBehavior extends Behavior {
  name = "Demon Hunter [Vengeance]";
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Vengeance;
  static settings = [
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "VengeanceUseMetamorphosis", text: "Use Metamorphosis offensively", default: true },
        { type: "checkbox", uid: "VengeanceChaosNovaMultiCasters", text: "Use Chaos Nova on multiple casters", default: true },
        { type: "hotkey", uid: "VengeanceInfernalStrikeUse", text: "Infernal Strike Toggle", default: null },
        { type: "hotkey", uid: "VengeanceSigilOfSpiteUse", text: "Sigil of Spite Toggle", default: null },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "VengeanceDemonSpikes2Charges", text: "Use Demon Spikes at 2 charges (HP %)", min: 1, max: 100, default: 95 },
        { type: "slider", uid: "VengeanceDemonSpikes1Charge", text: "Use Demon Spikes at 1 charge (HP %)", min: 1, max: 100, default: 65 },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      new bt.Action(() => me.deadOrGhost ? bt.Status.Success : bt.Status.Failure),

      // Off-GCD abilities — must be outside the GCD Decorator
      spell.cast("Torment", on => combat.targets.find(t => t.target && !t.isTanking())),
      spell.cast("Demon Spikes", on => me, req => this.shouldUseDemonSpikes()),
      spell.interrupt("Disrupt"),
      spell.cast("Infernal Strike", on => me.targetUnit, req => KeyBinding.isBehaviorHotkeyDown("VengeanceInfernalStrikeUse")),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Chaos Nova", on => me, req => this.shouldUseChaosNova()),
          common.waitForCombat(),
          common.waitForTarget(),
          common.ensureAutoAttack(),

          // Metamorphosis — won't overcap duration, Spirit Bomb CD > 10s
          spell.cast("Metamorphosis", on => me, req => this.shouldUseMetamorphosis()),

          // Fracture anti-cap at near 2 charges
          spell.cast("Fracture", on => combat.bestTarget, req => spell.getCharges("Fracture") >= 2),

          // Spirit Bomb with 4+ Souls when Fiery Brand is about to expire
          spell.cast("Spirit Bomb", on => me, req => {
            return this.soulFragments() >= 4 && this.fieryBrandExpiring(combat.bestTarget);
          }),

          // Fiery Brand if debuff not active on target
          spell.cast("Fiery Brand", on => combat.bestTarget, req => {
            return combat.bestTarget && !combat.bestTarget.hasAuraByMe(auras.fieryBrand);
          }),

          // Spirit Bomb at 6 Souls
          spell.cast("Spirit Bomb", on => me, req => this.soulFragments() >= 6),

          // Immolation Aura
          spell.cast("Immolation Aura", on => me, req => combat.bestTarget && me.isWithinMeleeRange(combat.bestTarget)),

          // Sigil of Flame
          spell.cast("Sigil of Flame", on => combat.bestTarget),

          // Sigil of Spite — hotkey or auto when won't overcap souls
          spell.cast("Sigil of Spite", on => combat.bestTarget, req => {
            if (KeyBinding.isBehaviorHotkeyDown("VengeanceSigilOfSpiteUse")) return true;
            return this.soulFragments() <= 3;
          }),

          // Fel Devastation at 50+ Fury, facing enemies, not moving
          spell.cast("Fel Devastation", on => me, req => {
            return me.power >= 50 && !me.isMoving() &&
              combat.targets.some(t => me.isFacing(t, 90) && me.isWithinMeleeRange(t));
          }),

          // Soul Cleave to spend Fury and Souls
          spell.cast("Soul Cleave", on => combat.bestTarget),

          // Fracture if won't cap Fury or Souls
          spell.cast("Fracture", on => combat.bestTarget, req => me.power <= 80 && this.soulFragments() <= 4),

          // Felblade if won't cap Fury
          spell.cast("Felblade", on => combat.bestTarget, req => me.power <= 80),

          // Throw Glaive filler
          spell.cast("Throw Glaive", on => combat.bestTarget),
        )
      )
    );
  }

  shouldUseMetamorphosis() {
    if (!Settings.VengeanceUseMetamorphosis) return false;
    if (me.hasAura(auras.metamorphosis)) return false;
    const spiritBombCD = spell.getCooldown("Spirit Bomb");
    return spiritBombCD && spiritBombCD.timeleft > 10000;
  }

  fieryBrandExpiring(target) {
    if (!target) return false;
    const fb = target.getAuraByMe(auras.fieryBrand);
    if (!fb) return false;
    return fb.remaining > 0 && fb.remaining < 4000;
  }

  shouldUseChaosNova() {
    if (!Settings.VengeanceChaosNovaMultiCasters) return false;
    return combat.targets.filter(t => me.distanceTo(t) <= 10 && t.isCastingOrChanneling).length > 1;
  }

  soulFragments() {
    const aura = me.getAura(auras.soulFragments);
    return aura ? aura.stacks : 0;
  }

  shouldUseDemonSpikes() {
    if (me.hasAura(auras.demonSpikes)) return false;

    const hasNearbyEnemies = combat.targets.some(unit => me.isWithinMeleeRange(unit));
    if (!hasNearbyEnemies) return false;

    const charges = spell.getCharges("Demon Spikes");
    if (charges === 2 && me.pctHealth <= Settings.VengeanceDemonSpikes2Charges) return true;
    return charges === 1 && me.pctHealth <= Settings.VengeanceDemonSpikes1Charge;
  }
}
