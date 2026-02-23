import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const spells = {
  drainLife: 234153
}

export class WarlockDemonologyBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Warlock.Demonology;
  name = "Warlock [Demonology]"

  static settings = [
    {
      header: "General",
      options: [
        { type: "slider", uid: "DemonologyDrainLifePercent", text: "Drain Life Percent", min: 0, max: 100, default: 80 },
      ]
    },
  ]

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        this.isCastingCustom(),
        common.waitForTarget(),
        spell.cast("Drain Life", on => combat.bestTarget, req => me.pctHealth < Settings.DemonologyDrainLifePercent),
        spell.castOneButtonRotation(combat.bestTarget)
      )
    );
  }

  isCastingCustom() {
    return new bt.Action(() => {
      const currentCast = me.currentCast || me.currentChannel;

      if (currentCast) {
        if (currentCast === spells.drainLife && me.pctHealth == 100) {
          return bt.Status.Failure;
        }
      }

      if (me.isCastingOrChanneling) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    });
  }
}
