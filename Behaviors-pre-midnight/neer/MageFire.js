import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

export class MageFireBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Fire;
  name = "Mage [Fire]"

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        spell.cast("Blazing Barrier", req => combat.targets.find(unit => me.distanceTo(unit) < 8)),
        common.waitForTarget(),
        common.waitForFacing(),
        spell.cast("Fire Blast", req => me.hasAura("Heating Up")),
        common.waitForCastOrChannel(),
        spell.cast("Pyroblast", req => me.hasAura("Hot Streak!")),
        spell.cast("Phoenix Flames", req => me.hasAura("Heating Up")),
        spell.cast("Fireball"),
        spell.cast("Scorch", { skipMovingCheck: true }),
      )
    );
  }
}
