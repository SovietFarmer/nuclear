import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const auras = {
  lightweaver: 390993,
  surgeoflight: 114255,
  rhapsody: 390636
};

export class PriestHolyBehavior extends Behavior {
  name = "Priest [Holy]";
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Holy;
  static settings = [
    {
      header: "Emergency Healing",
      options: [
        { type: "slider", uid: "HolyPriestGuardianSpiritPercent", text: "Guardian Spirit Percent", min: 0, max: 100, default: 20 },
      ]
    },
    {
      header: "Defensives",
      options: [
        { type: "slider", uid: "HolyPriestDesperatePrayerPercent", text: "Desperate Prayer Percent", min: 0, max: 100, default: 40 },
      ]
    },
    {
      header: "General",
      options: [
        { type: "checkbox", uid: "HolyPriestUseLightweaver", text: "Use Lightweaver Logic", default: true },
      ]
    },
    {
      header: "Single Target Healing",
      options: [
        { type: "slider", uid: "HolyPriestFlashHealPercent", text: "Flash Heal Percent", min: 0, max: 100, default: 40 },
        { type: "slider", uid: "HolyPriestHealPercent", text: "Heal Percent", min: 0, max: 100, default: 80 },
        { type: "slider", uid: "HolyPriestRenewPercent", text: "Renew Percent", min: 0, max: 100, default: 90 },
        { type: "slider", uid: "HolyPriestHolyWordSerenityPercent", text: "Holy Word: Serenity Percent", min: 0, max: 100, default: 70 },
        { type: "slider", uid: "HolyPriestSurgeOfLightPercent", text: "Surge of Light Flash Heal Percent", min: 0, max: 100, default: 95 },
      ]
    },
    {
      header: "Area of Effect Healing",
      options: [
        { type: "slider", uid: "HolyPriestHWSCount", text: "Holy Word: Sanctify Minimum Targets", min: 1, max: 10, default: 3 },
        { type: "slider", uid: "HolyPriestHWSPercent", text: "Holy Word: Sanctify Health Percent", min: 0, max: 100, default: 85 },
        { type: "slider", uid: "HolyPriestHaloCount", text: "Halo Minimum Targets", min: 1, max: 10, default: 3 },
        { type: "slider", uid: "HolyPriestHaloPercent", text: "Halo Health Percent", min: 0, max: 100, default: 85 },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      this.defensiveRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.dispelRotation(),
          this.emergencyHealing(),
          this.maintainLightweaver(),
          this.mainHealingRotation(),
          this.damageRotation()
        )
      )
    );
  }

  dispelRotation() {
    return new bt.Selector(
      spell.dispel("Purify", true, DispelPriority.Low, true, WoWDispelType.Magic, WoWDispelType.Disease)
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Desperate Prayer",
        on => me,
        req => me.inCombat() && me.pctHealth < Settings.HolyPriestDesperatePrayerPercent
      ),
      spell.cast("Fade",
        on => me,
        req => me.inCombat() && combat.targets.find(unit => unit.isTanking())
      )
    );
  }

  emergencyHealing() {
    return new bt.Selector(
      spell.cast("Guardian Spirit", on => this.findGuardianSpiritTarget()),
      spell.cast("Power Word: Life",
        on => this.findPowerWordLifeTarget(),
        req => true,
        { skipUsableCheck: true }
      )
    );
  }

  maintainLightweaver() {
    return new bt.Selector(
      spell.cast("Flash Heal",
        on => heal.getPriorityTarget(),
        req => Settings.HolyPriestUseLightweaver && (this.shouldCastFlashHealForLightweaver() || (me.hasAura(auras.surgeoflight) && this.shouldUseSurgeOfLight()))
      )
    );
  }

  shouldCastFlashHealForLightweaver() {
    if (!Settings.HolyPriestUseLightweaver) {
      return false;
    }
    const lightweaverAura = me.getAura(auras.lightweaver);
    const currentStacks = lightweaverAura?.stacks ?? 0;
    const desiredStacks = me.pctPower === 100 ? 2 : 1;

    if (me.pctPower === 100 && (!lightweaverAura || lightweaverAura.remaining < 3000)) {
      return true;
    }

    return currentStacks < desiredStacks;
  }

  shouldUseSurgeOfLight() {
    const lightweaverAura = me.getAura(auras.lightweaver);
    const surgeOfLightAura = me.getAura(auras.surgeoflight);

    if (!lightweaverAura || lightweaverAura.remaining < 3000) {
      return true;
    }

    if (surgeOfLightAura && surgeOfLightAura.remaining <= 2000) {
      return true;
    }

    return false;
  }

  mainHealingRotation() {
    return new bt.Selector(
      spell.cast("Holy Word: Serenity", on => this.findHolyWordSerenityTarget()),
      spell.cast("Holy Word: Sanctify", on => this.findHolyWordSanctifyTarget()),
      spell.cast("Halo", on => this.findHaloTarget()),
      spell.cast("Heal", on => this.findHealTarget()),
      spell.cast("Flash Heal", on => this.findFlashHealTarget()),
      spell.cast("Prayer of Mending", on => this.findPrayerOfMendingTarget()),
      spell.cast("Renew", on => this.findRenewTarget()),
    );
  }

  damageRotation() {
    return new bt.Decorator(
      ret => !me.target || !me.target.isPlayer(),
      new bt.Selector(
        spell.cast("Holy Word: Chastise", on => combat.bestTarget),
        spell.cast("Holy Fire", on => combat.bestTarget),
        this.castHolyNova(),
        spell.cast("Shadow Word: Pain", on => this.findShadowWordPainTarget()),
        spell.cast("Smite", on => combat.bestTarget)
      )
    );
  }

  findGuardianSpiritTarget() {
    const threshold = Settings.HolyPriestGuardianSpiritPercent;
    return heal.priorityList.find(unit => unit.pctHealth < threshold);
  }

  findCriticalHealTarget() {
    const threshold = Settings.HolyPriestFlashHealPercent;
    return heal.priorityList.find(unit => unit.pctHealth < threshold);
  }

  findPrayerOfMendingTarget() {
    return heal.priorityList.find(unit => unit.pctHealth < 100 && !unit.hasAuraByMe("Prayer of Mending"));
  }

  findRenewTarget() {
    const threshold = Settings.HolyPriestRenewPercent;
    return heal.priorityList.find(unit => unit.pctHealth < threshold && !unit.hasAuraByMe("Renew"));
  }

  findHolyWordSerenityTarget() {
    const threshold = Settings.HolyPriestHolyWordSerenityPercent;
    return heal.priorityList.find(unit => unit.pctHealth < threshold);
  }

  findShadowWordPainTarget() {
    return combat.targets.find(unit => {
      const swpDebuff = unit.getAuraByMe("Shadow Word: Pain");
      return !swpDebuff || swpDebuff.remaining <= 3000; // 3000 milliseconds = 3 seconds
    });
  }

  findHealTarget() {
    const lightweaverAura = me.getAura(auras.lightweaver);
    const healThreshold = Settings.HolyPriestHealPercent;

    if (Settings.HolyPriestUseLightweaver && lightweaverAura && lightweaverAura.stacks > 0) {
      return heal.priorityList.find(unit => unit.pctHealth < healThreshold);
    }

    return heal.priorityList.find(unit => unit.pctHealth < healThreshold);
  }

  findFlashHealTarget() {
    const surgeOfLightAura = me.getAura(auras.surgeoflight);
    const lightweaverAura = me.getAura(auras.lightweaver);
    const flashHealThreshold = Settings.HolyPriestFlashHealPercent;
    const surgeOfLightThreshold = Settings.HolyPriestSurgeOfLightPercent;

    if (surgeOfLightAura) {
      if (surgeOfLightAura.remaining <= 2000 || Settings.HolyPriestUseLightweaver && (!lightweaverAura || lightweaverAura.remaining < 3000)) {
        return heal.getPriorityTarget();
      }
      return heal.priorityList.find(unit => unit.pctHealth < surgeOfLightThreshold);
    }

    if (Settings.HolyPriestUseLightweaver && (!lightweaverAura || lightweaverAura.remaining < 3000)) {
      return heal.getPriorityTarget();
    }

    return heal.priorityList.find(unit => unit.pctHealth < flashHealThreshold);
  }

  castHolyNova() {
    return new bt.Selector(
      spell.cast("Holy Nova",
        on => me,
        req => me.getAuraStacks(auras.rhapsody) == 20 && this.getEnemiesInRange(12) > 0 || this.getEnemiesInRange(12) > 3
      )
    );
  }

  getEnemiesInRange(range) {
    return combat.targets.filter(unit => me.distanceTo(unit) < range).length;
  }

  findPowerWordLifeTarget() {
    return heal.priorityList.find(unit => unit.pctHealth < 35);
  }

  findHolyWordSanctifyTarget() {
    const threshold = Settings.HolyPriestHWSPercent;
    const minTargets = Settings.HolyPriestHWSCount;

    return heal.priorityList.find(unit => {
      const nearbyUnits = heal.priorityList.filter(nearby =>
        nearby.pctHealth < threshold &&
        unit.distanceTo(nearby) <= 10
      );
      return nearbyUnits.length >= minTargets;
    });
  }

  findHaloTarget() {
    const threshold = Settings.HolyPriestHaloPercent;
    const minTargets = Settings.HolyPriestHaloCount;

    const targetsInRange = heal.priorityList.filter(unit =>
      unit.pctHealth < threshold &&
      me.distanceTo(unit) <= 46
    );

    return targetsInRange.length >= minTargets ? me : null;
  }
}
