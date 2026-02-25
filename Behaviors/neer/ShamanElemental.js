import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";

const auras = {
  primordialWave: 375986,
  masterOfTheElements: 260734,
  magmaChamber: 381933,
  surgeOfPower: 285514,
  flameShock: 188389,
  lavaSurge: 77762,
}

export class ShamanElementalBehavior extends Behavior {
  name = "Shaman [Elemental]"
  context = BehaviorContext.Any;
  specialization = Specialization.Shaman.Elemental;

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotSitting(),
        common.waitForNotMounted(),
        common.waitForTarget(),
        common.waitForCastOrChannel(),
        common.waitForFacing(),
        spell.cast("Primordial Wave", on => me.target, ret => me.hasAura(auras.surgeOfPower)),
        spell.cast("Earth Shock", me.target, ret => me.power > 140 || me.hasAura(auras.masterOfTheElements)),
        spell.cast("Ancestral Swiftness", on => me),
        spell.cast("Storm Elemental", on => me.target),
        spell.cast("Stormkeeper", on => me),
        spell.cast("Liquid Magma Totem", on => me.target, ret => me.targetUnit.getUnitsAroundCount(10) > 2),
        spell.cast("Lava Burst", on => me.target, ret => me.hasAura(auras.primordialWave) && me.power >= 47),
        spell.cast("Flame Shock", on => this.getFlameShockTarget(), ret => this.getFlameShockTarget() !== undefined),
        spell.cast("Earthquake", on => me.target, ret => me.targetUnit.getUnitsAroundCount(12) > 1),
        spell.cast("Chain Lightning", on => me.target, ret => me.targetUnit.getUnitsAroundCount(12) > 1),
        spell.cast("Lightning Bolt", on => me.target),
        spell.cast("Lava Burst", on => me.target, ret => me.hasAura(auras.lavaSurge) && me.isMoving()),
        spell.cast("Frost Shock", on => me.target, ret => me.isMoving())
      )
    );
  }

  getFlameShockTarget() {
    if (me.target && !me.targetUnit.hasAuraByMe(auras.flameShock)) {
      return me.target;
    }

    const units = me.targetUnit.getUnitsAround(12);
    const targetWithoutFlameShock = units.find(unit => !unit.hasAuraByMe(auras.flameShock));

    if (targetWithoutFlameShock) {
      return targetWithoutFlameShock;
    } else {
      return undefined;
    }
  }
}
