import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class HunterInitialBehavior extends Behavior {
  name = "Demon Hunter [Initial]";
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Initial;
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForTarget(),
          common.ensureAutoAttack(),
          spell.cast("Sigil of Flame", on => combat.bestTarget),
          spell.cast("Chaos Strike", on => combat.bestTarget),
          spell.cast("Demon's Bite", on => combat.bestTarget)
        )
      )
    );
  }
}
