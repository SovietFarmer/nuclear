import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Pet from "@/Core/Pet";

export class HunterInitialBehavior extends Behavior {
  name = "Hunter [Initial]";
  context = BehaviorContext.Any;
  specialization = Specialization.Hunter.Initial;
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.cast("Call Pet 1", on => me, req => !Pet.current),
      spell.cast("Revive Pet", on => me, req => !Pet.isAlive()),
      Pet.follow(req => !me.target),
      Pet.attack(on => me.target),
      spell.cast("Growl", on => combat.targets.find(unit => unit.isTanking())),
      spell.cast("Claw", on => combat.bestTarget),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Kill Command", on => combat.bestTarget),
          spell.cast("Cobra Shot", on => combat.bestTarget),
          spell.cast("Barbed Shot", on => combat.bestTarget),
          spell.cast("Arcane Shot", on => combat.bestTarget),
          spell.cast("Steady Shot", on => combat.bestTarget, { skipMovingCheck: true }),
        )
      )
    );
  }
}
