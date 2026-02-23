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
  demonSpikes: 203819
}

export class DemonHunterVengeanceBehavior extends Behavior {
  name = "Demon Hunter [Vengeance]";
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Vengeance;
  static settings = [
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "VengeanceChaosNovaMultiCasters", text: "Use Chaos Nova on multiple casters", default: true },
        { type: "hotkey", uid: "VengeanceInfernalStrikeUse", text: "Infernal Strike Toggle", default: null },
        { type: "hotkey", uid: "VengeanceSigilOfSpiteUse", text: "Sigil of Spite Toggle", default: null },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "VengeanceDemonSpikes2Charges", text: "Use Demon Spikes at 2 charges (HP %)", min: 1, max: 100, default: 95 },
        { type: "slider", uid: "VengeanceDemonSpikes1Charge", text: "Use Demon Spikes at 1 charge (HP %)", min: 1, max: 100, default: 65 }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.cast("Torment", on => combat.targets.find(t => t.target && !t.isTanking())),
      spell.cast("Demon Spikes", on => me, req => this.shouldUseDemonSpikes()),
      spell.interrupt("Disrupt"),

      // Hotkey-based abilities
      spell.cast("Infernal Strike", on => me.targetUnit, req => KeyBinding.isBehaviorHotkeyDown("VengeanceInfernalStrikeUse")),
      spell.cast("Sigil of Spite", on => combat.bestTarget, req => KeyBinding.isBehaviorHotkeyDown("VengeanceSigilOfSpiteUse")),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Chaos Nova", on => me, req => this.shouldUseChaosNova()),
          common.waitForTarget(),
          common.ensureAutoAttack(),
          spell.cast("Reaver's Glaive", on => combat.bestTarget),
          spell.cast("Immolation Aura", on => me, req => combat.bestTarget && me.isWithinMeleeRange(combat.bestTarget)),
          spell.cast("Sigil of Spite", on => combat.bestTarget, req => combat.getUnitsAroundUnit(combat.bestTarget, 10).length > 1),
          spell.cast("Sigil of Flame", on => combat.bestTarget),
          spell.cast("Fel Devastation", on => me, req => !me.isMoving() && combat.targets.filter(t => me.isFacing(t, 90) && me.isWithinMeleeRange(t)).length > 0),
          spell.cast("Spirit bomb", on => me, req => {
            const hasNearbyEnemies = combat.targets.some(unit => me.isWithinMeleeRange(unit));
            return hasNearbyEnemies && this.soulFragments() >= 4;
          }),
          spell.cast("Fiery Brand", on => combat.bestTarget),
          spell.cast("Fracture", on => combat.bestTarget, req => this.soulFragments() < 5),
          spell.cast("Soul Cleave", on => combat.bestTarget),
          spell.cast("Felblade", on => combat.bestTarget, req => me.pctPower < 60),
          spell.cast("Throw Glaive", on => combat.bestTarget),
        )
      )
    );
  }

  shouldUseChaosNova() {
    if (!Settings.VengeanceChaosNovaMultiCasters) return false;

    const castingTargetsNearby = combat.targets.filter(t =>
      me.distanceTo(t) <= 10 &&
      t.isCastingOrChanneling
    ).length;

    return castingTargetsNearby > 1;
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
