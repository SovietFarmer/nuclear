import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { pvpHelpers } from "@/Data/PVPData";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";

const auras = {
  rejuvenation: 774,
  rejuvenationGermination: 155777,
  regrowth: 8936,
  lifebloom: 33763,
  lifebloomResto: 1227806,
  wildGrowth: 48438,
  soulOfTheForest: 114108,
  natureSwiftness: 132158,
  barkskin: 22812,
  bearForm: 5487,
  cyclone: 33786,
  moonfire: 164812,
  highWinds: 200931,
  markOfTheWild: 1126,
};

/**
 * Restoration Druid PvP — Midnight / Keeper (passive Grove Guardians on WG + Swiftmend; no Flourish button).
 * No Skull Bash / Mighty Bash interrupt; CC is Cyclone. Reactive Resin / Embrace of the Dream are passive — no extra casts.
 * Heal targeting: `heal.getPriorityPVPHealTarget()` + fallbacks (same idea as Resto Shaman). No cat weave; light Moonfire/Wrath filler.
 */
export class DruidRestorationPvP extends Behavior {
  name = "Restoration Druid PvP (Keeper)";
  context = BehaviorContext.Any;
  specialization = Specialization.Druid.Restoration;
  version = wow.GameVersion.Retail;

  healTarget = null;

  static settings = [
    {
      header: "Restoration Druid PvP",
      options: [
        { type: "slider", uid: "RDruidPvPBarkskinPct", text: "Barkskin HP %", default: 55, min: 20, max: 90 },
        { type: "slider", uid: "RDruidPvPBearPct", text: "Bear Form HP %", default: 40, min: 10, max: 70 },
        { type: "slider", uid: "RDruidPvPEmergencyPct", text: "Emergency healing (primary) HP %", default: 52, min: 25, max: 80 },
        { type: "slider", uid: "RDruidPvPTranqPct", text: "Tranquility average team HP % cap", default: 58, min: 30, max: 85 },
        { type: "slider", uid: "RDruidPvPIronbarkPct", text: "Ironbark HP %", default: 62, min: 30, max: 85 },
        { type: "slider", uid: "RDruidPvPRegrowthPct", text: "Regrowth (direct) HP %", default: 78, min: 40, max: 95 },
        { type: "slider", uid: "RDruidPvPWildGrowthPct", text: "Wild Growth ally HP % threshold", default: 92, min: 50, max: 100 },
        { type: "slider", uid: "RDruidPvPWildGrowthMin", text: "Wild Growth min hurt allies", default: 2, min: 2, max: 5 },
        { type: "slider", uid: "RDruidPvPRejuvPct", text: "Rejuvenation spread HP %", default: 96, min: 50, max: 100 },
        { type: "checkbox", uid: "RDruidPvPUseCyclone", text: "Cyclone (healer / DPS CDs)", default: true },
        { type: "checkbox", uid: "RDruidPvPUseThorns", text: "Thorns when trained (melee on you)", default: true },
        { type: "checkbox", uid: "RDruidPvPUseConvokeHeal", text: "Convoke the Spirits (healing)", default: true },
        { type: "checkbox", uid: "RDruidPvPUseIncarnation", text: "Incarnation: Tree of Life (burst toggle)", default: true },
        { type: "checkbox", uid: "RDruidPvPUseInnervateBurst", text: "Innervate during burst toggle", default: true },
        { type: "checkbox", uid: "RDruidPvPFillerDamage", text: "Moonfire / Wrath filler when safe", default: true },
      ],
    },
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        () => this.shouldStopCastingForHeals(),
        new bt.Action(() => {
          me.stopCasting();
          return bt.Status.Success;
        })
      ),
      this.ensurePrepBuffs(),
      common.waitForNotWaitingForArenaToStart(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          new bt.Action(() => {
            this.healTarget = heal.getPriorityPVPHealTarget();
            return bt.Status.Failure;
          }),
          this.exitBearWhenSafe(),
          this.defensiveCooldowns(),
          this.emergencyHealing(),
          new bt.Decorator(
            ret => this.hasBurstHealingCooldownsReady(),
            this.burstHealingCooldowns()
          ),
          this.cycloneRotation(),
          this.healRotation(),
          this.dispelRotation(),
          common.waitForTarget(),
          common.waitForFacing(),
          common.waitForCombat(),
          this.damageRotation()
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Prep
  // ---------------------------------------------------------------------------

  ensurePrepBuffs() {
    return new bt.Selector(
      spell.cast("Mark of the Wild", on => this.getMarkTarget(), ret => {
        if (!me.hasArenaPreparation()) return false;
        const t = this.getMarkTarget();
        return t != null && !t.hasAura(auras.markOfTheWild);
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Forms
  // ---------------------------------------------------------------------------

  exitBearWhenSafe() {
    return new bt.Decorator(
      ret =>
        me.hasAura(auras.bearForm) &&
        me.effectiveHealthPercent > 68 &&
        this.getLowestTeamHealth() > 72 &&
        !this.isEmergencyHealingNeeded(),
      new bt.Action(() => {
        const a = me.getAura(auras.bearForm);
        if (a) me.cancelAura(a.spellId);
        return bt.Status.Success;
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Defensives
  // ---------------------------------------------------------------------------

  defensiveCooldowns() {
    return new bt.Selector(
      spell.cast("Bear Form", ret =>
        me.effectiveHealthPercent <= Settings.RDruidPvPBearPct &&
        me.inCombat() &&
        !me.hasAura(auras.bearForm)
      ),
      spell.cast("Frenzied Regeneration", ret =>
        me.hasAura(auras.bearForm) &&
        me.effectiveHealthPercent < 78 &&
        spell.isSpellKnown("Frenzied Regeneration") &&
        !spell.isOnCooldown("Frenzied Regeneration")
      ),
      spell.cast("Barkskin", on => me, ret =>
        me.effectiveHealthPercent <= Settings.RDruidPvPBarkskinPct &&
        !me.hasAura(auras.barkskin) &&
        me.inCombat()
      ),
      spell.cast("Ironbark", on => me, ret =>
        spell.isSpellKnown("Ironbark") &&
        me.effectiveHealthPercent <= Settings.RDruidPvPIronbarkPct - 5 &&
        spell.getTimeSinceLastCast("Ironbark") > 2500
      ),
      spell.cast("Thorns", on => me, ret =>
        Settings.RDruidPvPUseThorns &&
        spell.isSpellKnown("Thorns") &&
        me.effectiveHealthPercent < 85 &&
        this.hasMeleePlayerOnUnit(me, 8) &&
        spell.getTimeSinceLastCast("Thorns") > 8000
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Emergency
  // ---------------------------------------------------------------------------

  emergencyHealing() {
    return new bt.Decorator(
      () => this.isEmergencyHealingNeeded(),
      new bt.Selector(
        spell.cast("Tranquility", on => me, ret =>
          spell.isSpellKnown("Tranquility") &&
          this.countAlliesUnderPct(Settings.RDruidPvPTranqPct) >= 3 &&
          spell.getTimeSinceLastCast("Tranquility") > 2500
        ),
        spell.cast("Nature's Swiftness", on => me, ret =>
          spell.isSpellKnown("Nature's Swiftness") &&
          !me.hasAura(auras.natureSwiftness) &&
          this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPEmergencyPct - 7
        ),
        spell.cast("Regrowth", on => this.getPrimaryHealTarget(), ret =>
          me.hasAura(auras.natureSwiftness) &&
          this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPEmergencyPct
        ),
        spell.cast("Swiftmend", on => this.getSwiftmendTarget(), ret =>
          this.getSwiftmendTarget() != null &&
          spell.getTimeSinceLastCast("Swiftmend") > 2000
        ),
        spell.cast("Ironbark", on => this.getIronbarkTarget(), ret =>
          spell.isSpellKnown("Ironbark") &&
          this.getIronbarkTarget() != null &&
          spell.getTimeSinceLastCast("Ironbark") > 2500
        ),
        spell.cast("Wild Growth", ret =>
          this.countAlliesUnderPct(Settings.RDruidPvPWildGrowthPct) >= 2
        ),
        spell.cast("Regrowth", on => this.getPrimaryHealTarget(), ret =>
          this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPEmergencyPct &&
          (!me.isMoving() || me.hasAura(auras.natureSwiftness))
        )
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Burst (global burst toggle + major heal CDs only)
  // ---------------------------------------------------------------------------

  hasBurstHealingCooldownsReady() {
    if (!combat.burstToggle || !me.inCombat()) return false;
    if (this.getLowestTeamHealth() > 88 && !this.isEmergencyHealingNeeded()) return false;

    const tree =
      Settings.RDruidPvPUseIncarnation &&
      spell.isSpellKnown("Incarnation: Tree of Life") &&
      !spell.isOnCooldown("Incarnation: Tree of Life");
    const convoke =
      Settings.RDruidPvPUseConvokeHeal &&
      spell.isSpellKnown("Convoke the Spirits") &&
      !spell.isOnCooldown("Convoke the Spirits");
    const innerv =
      Settings.RDruidPvPUseInnervateBurst &&
      spell.isSpellKnown("Innervate") &&
      !spell.isOnCooldown("Innervate");

    return tree || convoke || innerv;
  }

  burstHealingCooldowns() {
    return new bt.Selector(
      spell.cast("Incarnation: Tree of Life", on => me, ret =>
        Settings.RDruidPvPUseIncarnation &&
        spell.isSpellKnown("Incarnation: Tree of Life") &&
        !spell.isOnCooldown("Incarnation: Tree of Life") &&
        !me.hasVisibleAura("Incarnation: Tree of Life") &&
        (this.getLowestTeamHealth() < 82 || this.isEmergencyHealingNeeded())
      ),
      spell.cast("Innervate", on => me, ret =>
        Settings.RDruidPvPUseInnervateBurst &&
        spell.isSpellKnown("Innervate") &&
        (this.getManaPct() < 72 || this.isEmergencyHealingNeeded()) &&
        (me.hasVisibleAura("Incarnation: Tree of Life") || this.getLowestTeamHealth() < 75)
      ),
      spell.cast("Convoke the Spirits", on => me, ret =>
        Settings.RDruidPvPUseConvokeHeal &&
        spell.isSpellKnown("Convoke the Spirits") &&
        !me.isMoving() &&
        (this.countAlliesUnderPct(78) >= 2 || this.isEmergencyHealingNeeded())
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Sustained healing
  // ---------------------------------------------------------------------------

  healRotation() {
    return new bt.Selector(
      spell.cast("Ironbark", on => this.getIronbarkTarget(), ret =>
        spell.isSpellKnown("Ironbark") &&
        this.getIronbarkTarget() != null &&
        spell.getTimeSinceLastCast("Ironbark") > 2500
      ),
      spell.cast("Lifebloom", on => this.getLifebloomTarget(), ret => this.getLifebloomTarget() != null),
      // Swiftmend + WG first (Midnight: passive treants); Rejuv spread follows to refresh HoTs for next mend.
      spell.cast("Swiftmend", on => this.getSwiftmendTarget(), ret =>
        this.getSwiftmendTarget() != null &&
        spell.getTimeSinceLastCast("Swiftmend") > 2000
      ),
      spell.cast("Wild Growth", ret =>
        this.countAlliesUnderPct(Settings.RDruidPvPWildGrowthPct) >= Settings.RDruidPvPWildGrowthMin
      ),
      spell.cast("Rejuvenation", on => this.getRejuvTarget(), ret => this.getRejuvTarget() != null),
      spell.cast("Nature's Swiftness", on => me, ret =>
        spell.isSpellKnown("Nature's Swiftness") &&
        !me.hasAura(auras.natureSwiftness) &&
        me.hasAura(auras.soulOfTheForest) &&
        this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPRegrowthPct
      ),
      spell.cast("Regrowth", on => this.getPrimaryHealTarget(), ret =>
        me.hasAura(auras.soulOfTheForest) &&
        this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPRegrowthPct
      ),
      spell.cast("Regrowth", on => this.getPrimaryHealTarget(), ret =>
        this.getPrimaryHealTarget()?.effectiveHealthPercent < Settings.RDruidPvPRegrowthPct &&
        (!me.isMoving() || me.hasAura(auras.natureSwiftness))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // CC (no melee interrupt — Resto has no Skull Bash)
  // ---------------------------------------------------------------------------

  cycloneRotation() {
    return spell.cast("Cyclone", on => this.getCycloneTarget(), ret =>
      Settings.RDruidPvPUseCyclone &&
      this.getLowestTeamHealth() > 70 &&
      this.getCycloneTarget() != null &&
      spell.getTimeSinceLastCast("Cyclone") > 2800
    );
  }

  // ---------------------------------------------------------------------------
  // Dispels
  // ---------------------------------------------------------------------------

  dispelRotation() {
    return new bt.Selector(
      new bt.Decorator(
        () => spell.isSpellKnown("Nature's Cure"),
        spell.dispel("Nature's Cure", true, DispelPriority.High, true, WoWDispelType.Magic, WoWDispelType.Curse, WoWDispelType.Poison)
      ),
      new bt.Decorator(
        () => spell.isSpellKnown("Soothe"),
        spell.dispel("Soothe", false, DispelPriority.Medium, false, WoWDispelType.Enrage)
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Damage (no cat weave)
  // ---------------------------------------------------------------------------

  damageRotation() {
    return new bt.Selector(
      spell.cast("Moonfire", on => me.targetUnit, ret =>
        Settings.RDruidPvPFillerDamage &&
        me.targetUnit?.isPlayer() &&
        this.getLowestTeamHealth() > 72 &&
        !me.targetUnit.hasAuraByMe(auras.moonfire)
      ),
      spell.cast("Wrath", on => me.targetUnit, ret =>
        Settings.RDruidPvPFillerDamage &&
        me.targetUnit?.isPlayer() &&
        this.getLowestTeamHealth() > 78 &&
        spell.isSpellKnown("Wrath") &&
        (!me.isMoving() || me.hasAura(auras.natureSwiftness))
      )
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers — heal targets (same idea as ShamanRestorationPvP)
  // ---------------------------------------------------------------------------

  getPrimaryHealTarget() {
    const pvp = heal.getPriorityPVPHealTarget();
    if (pvp && me.withinLineOfSight(pvp)) return pvp;
    if (this.healTarget && me.withinLineOfSight(this.healTarget)) return this.healTarget;
    return this.getLowestHealthAlly();
  }

  getLowestHealthAlly() {
    const allies = heal.priorityList.filter(
      a => a && a.isPlayer() && me.withinLineOfSight(a)
    );
    if (!allies.some(a => a.guid.equals(me.guid))) allies.push(me);
    if (allies.length === 0) return null;
    return allies.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0];
  }

  getLowestTeamHealth() {
    const t = this.getLowestHealthAlly();
    return t ? t.effectiveHealthPercent : 100;
  }

  countAlliesUnderPct(pct) {
    const allies = heal.priorityList.filter(
      a => a && a.isPlayer() && me.withinLineOfSight(a) && a.effectiveHealthPercent < pct
    );
    if (me.withinLineOfSight(me) && me.effectiveHealthPercent < pct &&
        !allies.some(a => a.guid.equals(me.guid))) {
      allies.push(me);
    }
    return allies.length;
  }

  isEmergencyHealingNeeded() {
    if (!me.inCombat()) return false;
    const t = this.getPrimaryHealTarget();
    if (!t || !me.withinLineOfSight(t)) return false;
    return t.effectiveHealthPercent <= Settings.RDruidPvPEmergencyPct;
  }

  hasLifebloomOnUnit(u) {
    return u.hasAuraByMe(auras.lifebloom) || u.hasAuraByMe(auras.lifebloomResto);
  }

  /**
   * Midnight Resto: only one Lifebloom at a time — always the primary heal target.
   * Casting on a new focus moves the bloom; refresh when pandemic window (~4.5s).
   */
  getLifebloomTarget() {
    const primary = this.getPrimaryHealTarget();
    if (!primary || !me.withinLineOfSight(primary) || me.distanceTo(primary) > 40) {
      return null;
    }
    if (!this.hasLifebloomOnUnit(primary)) {
      return primary;
    }
    const lb =
      primary.getAuraByMe(auras.lifebloomResto) || primary.getAuraByMe(auras.lifebloom);
    if (lb && lb.remaining > 0 && lb.remaining <= 4500) {
      return primary;
    }
    return null;
  }

  needsRejuvStack(u) {
    if (u.effectiveHealthPercent > Settings.RDruidPvPRejuvPct) return false;
    if (!u.hasAura(auras.rejuvenation)) return true;
    if (spell.isSpellKnown("Germination") && !u.hasAura(auras.rejuvenationGermination)) return true;
    const aur = u.getAura(auras.rejuvenation);
    if (aur && aur.remaining < 4500) return true;
    return false;
  }

  getRejuvTarget() {
    const allies = heal.priorityList.filter(
      a => a && a.isPlayer() && me.withinLineOfSight(a) && me.distanceTo(a) <= 40
    );
    if (!allies.some(a => a.guid.equals(me.guid))) allies.push(me);
    const candidates = allies.filter(a => this.needsRejuvStack(a));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent);
    return candidates[0];
  }

  hasSwiftmendableHoT(u) {
    return (
      u.hasAura(auras.rejuvenation) ||
      u.hasAura(auras.regrowth) ||
      u.hasAura(auras.wildGrowth) ||
      this.hasLifebloomOnUnit(u)
    );
  }

  getSwiftmendTarget() {
    const allies = heal.priorityList.filter(
      a => a && a.isPlayer() && me.withinLineOfSight(a) && me.distanceTo(a) <= 40
    );
    if (!allies.some(a => a.guid.equals(me.guid))) allies.push(me);
    const mendHp = Math.max(Settings.RDruidPvPWildGrowthPct, Settings.RDruidPvPRejuvPct);
    const hurt = allies.filter(
      a => this.hasSwiftmendableHoT(a) && a.effectiveHealthPercent < mendHp
    );
    if (hurt.length === 0) return null;
    hurt.sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent);
    return hurt[0];
  }

  getIronbarkTarget() {
    const allies = heal.priorityList.filter(
      a => a && a.isPlayer() && me.withinLineOfSight(a) && me.distanceTo(a) <= 40
    );
    if (!allies.some(a => a.guid.equals(me.guid))) allies.push(me);
    const t = allies
      .filter(a => a.effectiveHealthPercent <= Settings.RDruidPvPIronbarkPct && !a.hasAura("Ironbark"))
      .sort((a, b) => a.effectiveHealthPercent - b.effectiveHealthPercent)[0];
    return t || null;
  }

  getMarkTarget() {
    const allies = heal.priorityList.filter(a => a && me.withinLineOfSight(a) && me.distanceTo(a) <= 40);
    if (!allies.some(a => a.guid.equals(me.guid))) allies.push(me);
    const missing = allies.find(a => !a.hasAura(auras.markOfTheWild));
    return missing || allies[0] || me;
  }

  // ---------------------------------------------------------------------------
  // CC targets (adapted from pre-midnight Balance PvP)
  // ---------------------------------------------------------------------------

  getCycloneTarget() {
    const enemies = me.getPlayerEnemies(me.hasAura(auras.highWinds) ? 30 : 25);
    for (const e of enemies) {
      if (e.hasAuraByMe(auras.cyclone)) return null;
    }
    const maxDR = me.targetUnit && me.targetUnit.effectiveHealthPercent < 35 ? 2 : 1;
    for (const unit of enemies) {
      if (
        unit.isHealer() &&
        !unit.isCCd() &&
        unit.canCC() &&
        unit.getDR("disorient") <= maxDR &&
        me.withinLineOfSight(unit) &&
        !pvpHelpers.hasImmunity(unit)
      ) {
        return unit;
      }
    }
    for (const unit of enemies) {
      if (
        !unit.isHealer() &&
        unit.isPlayer() &&
        !unit.isCCd() &&
        unit.canCC() &&
        unit.getDR("disorient") <= 1 &&
        me.withinLineOfSight(unit) &&
        !pvpHelpers.hasImmunity(unit) &&
        pvpHelpers.hasMajorDamageCooldown(unit, 3000)
      ) {
        return unit;
      }
    }
    return null;
  }

  hasMeleePlayerOnUnit(unit, yards) {
    return combat.targets.some(
      t => t && t.isPlayer() && unit.distanceTo(t) <= yards && me.withinLineOfSight(t)
    );
  }

  shouldStopCastingForHeals() {
    if (!me.isCastingOrChanneling) return false;
    const cur = me.currentCastOrChannel;
    if (!cur || cur.timeleft < 350) return false;
    const filler = cur.name === "Wrath" || cur.name === "Moonfire" || cur.name === "Sunfire";
    return filler && this.isEmergencyHealingNeeded();
  }

  getManaPct() {
    const max = me.maxPowerByType(PowerType.Mana);
    if (!max) return 100;
    return (me.powerByType(PowerType.Mana) / max) * 100;
  }
}
