import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";


const auras = {
}

export class HunterSurvivalBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.Survival;
  name = "Hunter [Survival]"

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        common.waitForCastOrChannel(),
        common.waitForTarget(),
        common.ensureAutoAttack(),
        spell.castOneButtonRotation(me.targetUnit)
      )
    );
  }
}
