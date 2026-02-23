import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class MageArcaneBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Arcane;
  name = "Mage [Arcane]";

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      spell.interrupt("Counterspell"),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Arcane Explosion", req =>
            combat.targets.filter(unit => me.distanceTo(unit) <= 12).length > 1 &&
            me.powerByType(PowerType.ArcaneCharges) < 4
          ),
          spell.cast("Arcane Intellect", req =>
            !me.hasVisibleAura("Arcane Intellect")
          ),
          common.waitForTarget(),
          common.waitForFacing(),
          spell.cast("Prismatic Barrier", req =>
            combat.targets.find(unit => me.distanceTo(unit) < 8 && unit.isTanking())
          ),
          spell.cast("Arcane Missiles"),
          spell.cast("Arcane Orb", req => {
            const facingTargets = combat.targets.filter(unit => me.isFacing(unit, 20) && !unit.isMoving());
            return facingTargets.length > 1 && me.powerByType(PowerType.ArcaneCharges);  // Cast if more than 1 target is within 20 degrees
          }),
          spell.cast("Arcane Barrage", req =>
            me.isMoving() || me.powerByType(PowerType.ArcaneCharges) > 3
          ),
          spell.cast("Arcane Blast")
        )
      )
    );
  }
}
