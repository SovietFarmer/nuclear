import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { MovementFlags } from "@/Enums/Flags";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { PowerType } from "@/Enums/PowerType";
import Settings from "@/Core/Settings";

const auras = {
  beaconoflight: 53563,
  freePower: 414445,
  beaconofvirtue: 200025,
  avengingcrusader: 216331,
  veneration: 392939
};

export class PaladinHolyBehavior extends Behavior {
  name = "Paladin [Holy]";
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Holy;
  static settings = [
    {
      header: "Emergency Healing",
      options: [
        { type: "slider", uid: "HolyPaladinLayOnHandsPercent", text: "Lay On Hands Percent", min: 0, max: 100, default: 20 },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "HolyPaladinDivineShieldPercent", text: "Divine Shield Percent", min: 0, max: 100, default: 40 },
        { type: "slider", uid: "HolyPaladinDivineProtectionPercent", text: "Divine Protection Percent", min: 0, max: 100, default: 75 },
      ]
    },
    {
      header: "Single Target Healing",
      options: [
        { type: "slider", uid: "HolyPaladinHolyShockPercent", text: "Holy Shock Percent", min: 0, max: 100, default: 0 },
        { type: "slider", uid: "HolyPaladinFlashofLightPercent", text: "Flash of Light Percent", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "HolyPaladinHolyLightPercent", text: "Holy Light Percent", min: 0, max: 100, default: 0 },
        { type: "slider", uid: "HolyPaladinWoGPercent", text: "WoG Percent", min: 0, max: 100, default: 0 },
      ]
    },
    {
      header: "AOE Healing",
      options: [
        { type: "slider", uid: "HolyPaladinLightofDawnPercent", text: "Light of Dawn Percent", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "HolyPaladinLightofDawnCount", text: "Light of Dawn Count", min: 0, max: 10, default: 3 },
        { type: "slider", uid: "HolyPaladinDivineTollPercent", text: "Divine Toll Percent", min: 0, max: 100, default: 60 },
        { type: "slider", uid: "HolyPaladinDivineTollCount", text: "Divine Toll Count", min: 0, max: 10, default: 3 },
        { type: "slider", uid: "HolyPaladinBeaconOfVirtuePercent", text: "Beacon of Virtue Percent", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "HolyPaladinBeaconOfVirtueCount", text: "Beacon of Virtue Count", min: 0, max: 10, default: 3 },
      ]
    },
    {
      header: "Utility",
      options: [
        { type: "slider", uid: "HolyPaladinBlessingOfProtectionPercent", text: "Blessing of Protection Percent", min: 0, max: 100, default: 30 },
        { type: "slider", uid: "HolyPaladinDivineSacrificePercent", text: "Divine Sacrifice Percent", min: 0, max: 100, default: 75 },
        { type: "checkbox", uid: "HolyPaladinUseBlessingOfFreedom", text: "Use Blessing of Freedom", default: true },
      ]
    }
  ];
  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      this.interruptRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.defensiveRotation(),
          this.dispelRotation(),
          this.emergencyHealing(),
          this.utilityRotation(),
          new bt.Decorator(
            ret => me.hasAura(auras.avengingcrusader),
            this.damageRotation()
          ),
          this.aoeHealingRotation(),
          this.mainHealingRotation(),
          this.damageRotation()
        )
      )
    );
  }

  interruptRotation() {
    return new bt.Selector(
      spell.interrupt("Rebuke")
    );
  }

  dispelRotation() {
    return new bt.Selector(
      spell.dispel("Cleanse Toxins", true, DispelPriority.Low, false, WoWDispelType.Magic, WoWDispelType.Disease, WoWDispelType.Poison)
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Divine Shield",
        on => me,
        req => me.effectiveHealthPercent < Settings.HolyPaladinDivineShieldPercent && combat.targets.find(unit => unit.isTanking())
      ),
      spell.cast("Divine Protection",
        on => me,
        req => me.effectiveHealthPercent < Settings.HolyPaladinDivineProtectionPercent && !me.hasAura("Divine Shield")
      )
    );
  }

  emergencyHealing() {
    return new bt.Selector(
      spell.cast("Lay On Hands",
        on => heal.priorityList.find(unit =>
          unit.effectiveHealthPercent < Settings.HolyPaladinLayOnHandsPercent &&
          combat.targets.some(enemy => enemy.targetUnit && enemy.targetUnit.guid.equals(unit.guid))
        )
      )
    );
  }

  utilityRotation() {
    return new bt.Selector(
      spell.cast("Blessing of Protection",
        on => heal.priorityList.find(unit =>
          unit.effectiveHealthPercent < Settings.HolyPaladinBlessingOfProtectionPercent &&
          !unit.hasAura("Forbearance") &&
          unit != me &&
          !heal.friends.Tanks.find(tank => tank.guid.equals(unit.guid)) &&
          unit.getUnitsAround(10).length > 0
        )
      ),
      spell.cast("Divine Sacrifice",
        on => heal.friends.Tanks.find(tank =>
          tank.effectiveHealthPercent < Settings.HolyPaladinDivineSacrificePercent &&
          combat.getUnitsAroundUnit(tank, 10).length >= 3 &&
          !tank.hasAura("Divine Sacrifice") &&
          tank != me
        )
      ),
      spell.cast("Blessing of Freedom",
        on => heal.priorityList.find(unit =>
          unit.isRooted() ||
          unit.isSlowed()
        ),
        req => Settings.HolyPaladinUseBlessingOfFreedom
      )
    );
  }

  aoeHealingRotation() {
    return new bt.Selector(
      spell.cast("Beacon of Virtue",
        on => heal.priorityList.find(unit =>
          unit.effectiveHealthPercent < Settings.HolyPaladinBeaconOfVirtuePercent &&
          heal.priorityList.filter(friend =>
            friend.distanceTo(unit) <= 30 &&
            friend.effectiveHealthPercent < Settings.HolyPaladinBeaconOfVirtuePercent
          ).length >= Settings.HolyPaladinBeaconOfVirtueCount
        )
      ),
      spell.cast("Holy Prism",
        on => combat.bestTarget,
        req => heal.priorityList.filter(unit =>
          unit.effectiveHealthPercent < 90 &&
          combat.bestTarget.distanceTo(unit) <= 30
        ).length > 1
      ),
      spell.cast("Divine Toll",
        on => me,
        req => me.powerByType(PowerType.HolyPower) <= 2 &&
          heal.priorityList.filter(unit =>
            unit.effectiveHealthPercent < Settings.HolyPaladinDivineTollPercent
          ).length >= Settings.HolyPaladinDivineTollCount
      ),
      spell.cast("Light of Dawn",
        on => me,
        req => heal.priorityList.filter(unit =>
          me.isFacing(unit) &&
          me.distanceTo(unit) <= 15 &&
          unit.effectiveHealthPercent < Settings.HolyPaladinLightofDawnPercent
        ).length >= Settings.HolyPaladinLightofDawnCount
      )
    );
  }

  mainHealingRotation() {
    return new bt.Selector(
      spell.cast("Word of Glory",
        on => heal.priorityList.find(unit => unit.effectiveHealthPercent < Settings.HolyPaladinWoGPercent || unit.hasAura(auras.freePower) && unit.effectiveHealthPercent < 100)
      ),
      spell.cast("Holy Shock",
        on => heal.priorityList.find(unit => unit.effectiveHealthPercent < Settings.HolyPaladinHolyShockPercent),
      ),
      spell.cast("Holy Light",
        on => heal.priorityList.find(unit => unit.effectiveHealthPercent < Settings.HolyPaladinHolyLightPercent),
      ),
      spell.cast("Flash of Light",
        on => heal.priorityList.find(unit => unit.effectiveHealthPercent < Settings.HolyPaladinFlashofLightPercent),
      ),
    );
  }

  damageRotation() {
    return new bt.Selector(
      new bt.Decorator(
        ret => me.powerByType(PowerType.HolyPower) >= 5 && combat.targets.find(unit => me.isFacing(unit) && me.distanceTo(unit) <= 8),
        spell.cast("Shield of the Righteous", on => combat.bestTarget)
      ),
      new bt.Decorator(
        ret => me.powerByType(PowerType.HolyPower) < 5,
        spell.cast("Judgment", on => combat.bestTarget)
      ),
      new bt.Decorator(
        ret => me.powerByType(PowerType.HolyPower) < 5 && spell.getCooldown("Holy Shock").timeleft > 2000,
        spell.cast("Crusader Strike", on => combat.bestTarget)
      ),
      new bt.Decorator(
        ret => me.powerByType(PowerType.HolyPower) < 5,
        spell.cast("Hammer of Wrath",
          on => combat.targets.find(unit => (unit.effectiveHealthPercent < 20 || me.hasAura(auras.veneration))),
          { skipUsableCheck: true }
        )
      ),
      new bt.Decorator(
        ret => !me.isMoving() && combat.targets.find(unit => me.distanceTo(unit) <= 10),
        spell.cast("Consecration", on => me)
      ),
      new bt.Decorator(
        ret => me.powerByType(PowerType.HolyPower) < 5,
        spell.cast("Holy Shock", on => combat.bestTarget)
      )
    );
  }
}
