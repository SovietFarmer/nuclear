import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";

export class DruidGuardianBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Guardian;
  name = "Druid [Guardian]";

  static settings = [
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "GuardianDruidFrenziedRegenerationCharge2Percent", text: "Frenzied Regeneration Charge 2 Health Percent", min: 0, max: 100, default: 70 },
        { type: "slider", uid: "GuardianDruidFrenziedRegenerationCharge1Percent", text: "Frenzied Regeneration Charge 1 Health Percent", min: 0, max: 100, default: 45 },
        { type: "slider", uid: "GuardianDruidSurvivalInstinctsPercent", text: "Survival Instincts Health Percent", min: 0, max: 100, default: 30 },
        { type: "slider", uid: "GuardianDruidBarkskinPercent", text: "Barkskin Health Percent", min: 0, max: 100, default: 75 },
      ]
    },
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "GuardianDruidUseGrowl", text: "Use Growl", default: true },
      ]
    },
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.interrupt("Skull Bash"),
      this.tauntLogic(),
      this.defensiveRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.utilityRotation(),
          common.waitForTarget(),
          this.damageRotation()
        )
      )
    );
  }

  tauntLogic() {
    return new bt.Selector(
      spell.cast("Growl", on => combat.targets.find(unit => unit.inCombat && unit.target && !unit.isTanking(), req => Settings.GuardianDruidUseGrowl))
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Survival Instincts", on => me, req => me.pctHealth < Settings.GuardianDruidSurvivalInstinctsPercent),
      spell.cast("Frenzied Regeneration", on => me, req => me.pctHealth < Settings.GuardianDruidFrenziedRegenerationCharge2Percent),
      spell.cast("Frenzied Regeneration", on => me, req => me.pctHealth < Settings.GuardianDruidFrenziedRegenerationCharge1Percent),
      spell.cast("Ironfur", on => me, req => me.pctPowerByType(PowerType.Rage) > 60),
      spell.cast("Barkskin", on => me, req => me.pctHealth < Settings.GuardianDruidBarkskinPercent),
    );
  }

  utilityRotation() {
    return new bt.Selector(
      spell.cast("Mark of the Wild", on => me, req => heal.friends.All.find(f => !f.hasAura("Mark of the Wild"))),
    );
  }

  damageRotation() {
    return new bt.Selector(
      spell.cast("Bear Form", on => me, req => !me.hasVisibleAura("Bear Form") && me.inCombat),
      spell.cast("Moonfire", on => me.target, req => !me.target.hasAuraByMe("Moonfire")),
      spell.cast("Thrash", on => me, req => combat.getUnitsAroundUnit(me, 10).length > 0),
      spell.cast("Mangle", on => me.target, req => me.pctPowerByType(PowerType.Rage) < 90),
      spell.cast("Berserk", on => me, req => me.target && me.distanceTo(me.target) < 8),
      spell.cast("Maul", on => me.target, req => me.hasAura("Tooth and Claw")),
      spell.cast("Swipe", on => me, req => combat.getUnitsAroundUnit(me, 10).length > 1),
      spell.cast("Moonfire", on => me.target)
    );
  }
}
