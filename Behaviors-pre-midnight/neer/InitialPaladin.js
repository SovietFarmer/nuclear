import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class PaladinInitialBehavior extends Behavior {
  name = "Paladin [Initial]";
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Initial;
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.ensureAutoAttack(),
      spell.cast("Shield of the Righteous"),
      spell.cast("Consecration", on => me.target, req => !me.isMoving()),
      spell.cast("Judgment"),
      spell.cast("Crusader Strike")
    );
  }
}
