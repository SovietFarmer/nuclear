import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class DemonHunterHavocBehavior extends Behavior {
  name = "Demon Hunter [Havoc]";
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Havoc;
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Eye Beam", on => me, req => !me.isMoving() && combat.targets.filter(t => me.isFacing(t, 90)).length > 0),
          spell.cast("Blade Dance", on => combat.bestTarget, req => combat.getUnitsAroundUnit(me, 10) > 0),
          spell.cast("Sigil of Flame", on => combat.bestTarget, req => combat.getUnitsAroundUnit(combat.bestTarget, 10) > 0),
          spell.cast("Chaos Strike", on => combat.bestTarget),
          spell.cast("Immolation Aura", on => me, req => combat.bestTarget && me.isWithinMeleeRange(combat.bestTarget)),
          spell.cast("Demon's Bite", on => combat.bestTarget),
          spell.cast("Throw Glaive", on => combat.bestTarget),
          common.waitForTarget(),
          common.ensureAutoAttack(),
        )
      )
    );
  }
}
