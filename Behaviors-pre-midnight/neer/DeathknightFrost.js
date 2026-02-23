import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";


const auras = {
  darkSuccor: 101568,
  rime: 59052,
}

export class DeathKnightFrostBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Frost;
  name = "Deathknight [Frost]"

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        common.waitForCastOrChannel(),
        common.waitForTarget(),
        common.ensureAutoAttack(),
        spell.cast("Empower Rune Weapon", on => me, req => me.pctPower < 60 && me.isWithinMeleeRange(me.target)),
        spell.cast("Death Strike", on => me.target, req => me.pctHealth < 80),
        spell.cast("Death and Decay", on => me.target, req => !me.isMoving() && combat.getUnitsAroundUnit(me.target, 12) > 1),
        spell.cast("Glacial Advance", on => me.target, req => combat.targets.filter(unit => me.isFacing(unit) && me.distanceTo(unit) < 10).length > 1),
        spell.cast("Howling Blast", on => me.target, req => me.hasAura(auras.rime)),
        spell.cast("Frost Strike", on => me.target),
        spell.cast("Obliterate", on => me.target),
        spell.cast("Death Strike", on => me.target, req => me.hasAura(auras.darkSuccor))
      )
    );
  }
}
