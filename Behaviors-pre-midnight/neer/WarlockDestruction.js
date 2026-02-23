import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";


const auras = {
  backdraft: 117828
}

export class WarlockDestructionBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Warlock.Destruction;
  name = "Warlock [Destruction]"

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        common.waitForCastOrChannel(),
        common.waitForTarget(),
        spell.cast("Drain Life", on => combat.bestTarget, req => me.pctHealth < 80),
        spell.castOneButtonRotation(combat.bestTarget)
      )
    );
  }
}
