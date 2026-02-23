import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class MonkInitialBehavior extends Behavior {
  name = "Monk [Initial]";
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Initial;
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      spell.cast("Blackout Kick"),
      spell.cast("Tiger Palm"),
    );
  }
}
