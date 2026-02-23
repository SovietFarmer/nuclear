import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import Settings from "@/Core/Settings";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType as DispelType } from "@/Enums/Auras";

const auras = {
  fingersoffrost: 44544,
  winterschill: 228358,
  frozen: 378760
};

export class FrostMageBehavior extends Behavior {
  name = "Mage [Frost]";
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Frost;

  static settings = [
    {
      header: "General",
      options: [
        { type: "checkbox", uid: "FrostMageArcaneIntellect", text: "Cast Arcane Intellect", default: false },
        { type: "checkbox", uid: "FrostMageIceBarrier", text: "Cast Ice Barrier", default: false },
      ]
    },
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "FrostMagePolymorph", text: "Polymorph non-target enemies", default: false },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.interrupt("Counterspell"),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Arcane Intellect", on => me, req => Settings.FrostMageArcaneIntellect && !me.hasVisibleAura("Arcane Intellect")),
          spell.dispel("Spellsteal", false, DispelPriority.Low, false, DispelType.Magic),
          spell.cast("Ice Barrier", on => me, req => this.shouldCastIceBarrier()),
          spell.cast("Arcane Explosion", on => me, req => combat.targets.filter(unit => me.distanceTo(unit) <= 10).length > 2),
          spell.cast("Polymorph", req => this.shouldCastPolymorph()),
          spell.cast("Ice Lance", on => {
            const winterChillTarget = combat.targets.find(unit => unit.hasAura(auras.winterschill));
            return winterChillTarget || combat.bestTarget;
          }, req => {
            if (combat.targets.some(unit => unit.hasAura(auras.winterschill))) {
              return true;
            }
            const fingersOfFrostStacks = me.getAuraStacks(auras.fingersoffrost);
            return fingersOfFrostStacks === 2 ||
              ((fingersOfFrostStacks === 1 || combat.bestTarget.hasAura(auras.frozen)) && (spell.getTimeSinceLastCast("Frostbolt") < 1000 || me.isMoving()));
          }),
          spell.cast("Flurry", on => combat.bestTarget, req => spell.getTimeSinceLastCast("Frostbolt") < 1000 && !combat.bestTarget.hasAura(auras.winterschill)),
          spell.cast("Frostbolt", on => combat.bestTarget),
        )
      )
    );
  }

  shouldCastIceBarrier() {
    if (!Settings.FrostMageIceBarrier) {
      return false;
    }

    if (me.hasVisibleAura("Ice Barrier")) {
      return false;
    }

    // Cast Ice Barrier if we're in combat and below 90% health
    if (me.inCombat && me.pctHealth < 90) {
      return true;
    }

    // Cast Ice Barrier if there's an enemy targeting us
    const enemyTargetingUs = combat.targets.find(unit => unit.isTanking());
    if (enemyTargetingUs) {
      return true;
    }

    return false;
  }

  shouldCastPolymorph() {
    if (!Settings.FrostMagePolymorph) {
      return false;
    }

    const polymorphTarget = combat.targets.find(unit =>
      unit !== combat.bestTarget &&
      !unit.hasAura("Polymorph")
    );

    return !!polymorphTarget;
  }
}
