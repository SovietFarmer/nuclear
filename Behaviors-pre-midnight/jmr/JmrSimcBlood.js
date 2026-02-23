import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";
import { RaceType } from "@/Enums/UnitEnums";

export class DeathKnightBloodBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Blood;
  name = "Jmr Blood DK";

  static settings = [
    { header: "Jmr Blood DK Settings" },
    { header: "" },
    { header: "Auto Taunt" },
    { type: "checkbox", uid: "JmrADC", text: "Auto Dark Command", default: false },
    { type: "checkbox", uid: "JmrADG", text: "Auto Death Grip", default: false },
    { header: "" },
    { header: "Defensive Cooldowns" },
    { type: "slider", uid: "JmrDSPercent", text: "Death Strike Health Percent", min: 0, max: 100, default: 75 },
    { type: "slider", uid: "JmrRuneTapSetting", text: "Rune Tap Health Percent", min: 0, max: 100, default: 65 },
    { type: "slider", uid: "JmrIBFSetting", text: "Icebound Fortitude Health Percent", min: 0, max: 100, default: 40 },
    { type: "slider", uid: "JmrVBSetting", text: "Vampiric Blood Health Percent", min: 0, max: 100, default: 55 },
    { type: "slider", uid: "JmrDeathStrikeDumpAmount", text: "Death Strike Dump Amount", min: 0, max: 100, default: 65 },
    { type: "slider", uid: "JmrLichborneSetting", text: "Lichborne Health Percent", min: 0, max: 100, default: 50 },
    { header: "" },
    { header: "Offensive Cooldowns" },
    { type: "slider", uid: "JmrDRWTTD", text: "Dancing Rune Weapon Time to Die", min: 0, max: 100, default: 10 },
    { header: "" },
    { header: "Utility" },
    { type: "slider", uid: "JmrDeathGripCharges", text: "Death Grip Charges to Save", min: 0, max: 2, default: 2 },
  ];

  constructor() {
    super();
    console.debug("DeathKnightBloodBehavior initialized");

    this.eventListener = new wow.EventListener();
    this.eventListener.onEvent = (event) => {
      if (event.name === "COMBAT_LOG_EVENT_UNFILTERED") {
        this.handleCombatLogEvent(event);
        //console.debug("Received combat log event");
      // } else if (event.name === "UNIT_SPELLCAST_START") {
      //   this.handleSpellCastStart(event);
      //   console.debug("Received spell cast start event");
      }
    };
  }

  handleCombatLogEvent(event) {

    const spellSchoolsMap = {
      0: "None",
      1: "Physical",
      2: "Holy",
      4: "Fire",
      8: "Nature",
      16: "Frost",
      32: "Shadow",
      64: "Arcane",
      3: "Holystrike",
      5: "Flamestrike",
      6: "Holyfire",
      9: "Stormstrike",
      10: "Holystorm",
      12: "Firestorm",
      17: "Froststrike",
      18: "Holyfrost",
      20: "Frostfire",
      24: "Froststorm",
      33: "Shadowstrike",
      34: "Shadowlight",
      36: "Shadowflame",
      40: "Shadowstorm",
      48: "Shadowfrost",
      65: "Spellstrike",
      66: "Divine",
      68: "Spellfire",
      72: "Spellstorm",
      80: "Spellfrost",
      96: "Spellshadow",
      28: "Elemental",
      124: "Chromatic",
      126: "Magic",
      127: "Chaos"
    };

    const eventTypesMap = {
      0: "ENVIRONMENTAL_DAMAGE",
      1: "SWING_DAMAGE",
      2: "SWING_MISSED",
      3: "RANGE_DAMAGE",
      4: "RANGE_MISSED",
      5: "SPELL_CAST_START",
      6: "SPELL_CAST_SUCCESS",
      7: "SPELL_CAST_FAILED",
      8: "SPELL_MISSED",
      9: "SPELL_DAMAGE",
      10: "SPELL_HEAL",
      11: "SPELL_ENERGIZE",
      12: "SPELL_DRAIN",
      13: "SPELL_LEECH",
      14: "SPELL_INSTAKILL",
      15: "SPELL_SUMMON",
      16: "SPELL_CREATE",
      17: "SPELL_INTERRUPT",
      18: "SPELL_EXTRA_ATTACKS",
      19: "SPELL_DURABILITY_DAMAGE",
      20: "SPELL_DURABILITY_DAMAGE_ALL",
      21: "SPELL_AURA_APPLIED",
      22: "SPELL_AURA_APPLIED_DOSE",
      23: "SPELL_AURA_REMOVED_DOSE",
      24: "SPELL_AURA_REMOVED",
      25: "SPELL_AURA_REFRESH",
      26: "SPELL_DISPEL",
      27: "SPELL_STOLEN",
      28: "SPELL_AURA_BROKEN",
      29: "SPELL_AURA_BROKEN_SPELL",
      30: "DAMAGE_AURA_BROKEN",
      31: "ENCHANT_APPLIED",
      32: "ENCHANT_REMOVED",
      33: "SPELL_PERIODIC_MISSED",
      34: "SPELL_PERIODIC_DAMAGE",
      35: "SPELL_PERIODIC_HEAL",
      36: "SPELL_PERIODIC_ENERGIZE",
      37: "SPELL_PERIODIC_DRAIN",
      38: "SPELL_PERIODIC_LEECH",
      39: "SPELL_DISPEL_FAILED",
      40: "DAMAGE_SHIELD",
      41: "DAMAGE_SHIELD_MISSED",
      42: "DAMAGE_SPLIT",
      43: "PARTY_KILL",
      44: "UNIT_DIED",
      45: "UNIT_DESTROYED",
      46: "SPELL_RESURRECT",
      47: "SPELL_BUILDING_DAMAGE",
      48: "SPELL_BUILDING_HEAL",
      49: "UNIT_DISSIPATES",
      50: "SWING_DAMAGE_LANDED",
      51: "SPELL_ABSORBED",
      52: "SPELL_HEAL_ABSORBED",
      53: "SPELL_EMPOWER_START",
      54: "SPELL_EMPOWER_END",
      55: "SPELL_EMPOWER_INTERRUPT"
  };

    if (typeof event.args === 'object') {
        //console.debug("Event args is an object, logging each key-value pair:");
        for (const [key, value] of Object.entries(event.args)) {
            //console.debug(`Key: ${key}, Value: ${JSON.stringify(value)}`);
        }
    } else {
        return;
    }

    if (event.args.length > 0) {
        const eventData = event.args[0];
        const subEvent = eventData.eventType || eventData[1];
        const sourceName = eventData.source?.name || "Unknown Source";
        const destName = eventData.destination?.name || "Unknown Target";
        const spellID = eventData.args ? eventData.args[0] : undefined;
        const spellName = spellID ? (new wow.Spell(spellID)).name : "Unknown Spell";
        const spellSchool = eventData.args ? eventData.args[90] : undefined;
        const schoolName = spellSchoolsMap[spellSchool] || `Unknown (${spellSchool})`;
        const subEventName = eventTypesMap[subEvent] || `Unknown (${subEvent})`;
        const destGUID = eventData.destination?.guid || undefined;

        if (subEventName === "SPELL_CAST_START" && destName === me.name && spellSchool !== 0 && spellSchool !== 1) {
          const sourceUnit = objMgr.findObject(eventData.source?.guid);
          if (sourceUnit instanceof wow.CGUnit && sourceUnit.inCombatWithMe) {
            const spellInfo = sourceUnit.spellInfo;
            if (spellInfo && spellInfo.cast !== 0) {
              this.lastEnemyCast = {
                spellID,
                spellName,
                sourceName,
                sourceUnit,
                castStart: wow.frameTime,
                castEnd: spellInfo.castEnd
              };
              console.debug(`Enemy ${this.lastEnemyCast.sourceName} is casting ${this.lastEnemyCast.spellName} (${this.lastEnemyCast.spellID}). Cast progress: ${castProgress * 100}%`);
          }
        }
      }
    }
  }


  destroy() {
    super.destroy();
  }

  shouldUseAntiMagicShell() {
    if (this.lastEnemyCast) {
      const currentTime = wow.frameTime;
      const castProgress = (currentTime - this.lastEnemyCast.castStart) / (this.lastEnemyCast.castEnd - this.lastEnemyCast.castStart);

      if (castProgress >= 0.90 && castProgress <= 0.99) {
        console.debug(`Enemy ${this.lastEnemyCast.sourceName} is casting ${this.lastEnemyCast.spellName} (${this.lastEnemyCast.spellID}). Cast progress: ${castProgress * 100}%`);
        return true;
      }
    }
    return false;
  }


  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCastOrChannel(),
          spell.cast("Raise Ally",
            on => me.targetUnit,
            req => me.targetUnit !== null && me.targetUnit.deadOrGhost && !me.targetUnit.isEnemy
          ),
          spell.cast("Anti-Magic Shell",
          on => me,
          req => this.shouldUseAntiMagicShell() && !me.hasVisibleAura("Anti-Magic Shell")
          ),
          common.waitForFacing(),
          common.waitForTarget(),
          spell.interrupt("Mind Freeze", false),
          spell.cast("Dark Command",
            on => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()),
            req => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()) !== undefined && Settings.JmrADC),
          spell.cast("Death Grip",
            on => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()),
            req => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()) !== undefined && spell.getCharges("Death Grip") > Settings.JmrDeathGripCharges && spell.getCharges("Death Grip") >= 1 && Settings.JmrADG),
          spell.cast("Blood Boil",
            on => me,
            req => me.getUnitsAroundCount(10) > 3 && spell.getCharges("Blood Boil") >= 1 && this.UnitsAroundMissingBloodPlague()),
          spell.cast("Rune Tap", on => me, req => me.inCombat() && me.pctHealth < Settings.JmrRuneTapSetting && !me.hasVisibleAura("Rune Tap")),
          spell.cast("Death Strike", on => this.getCurrentTarget(), req => me.pctHealth < Settings.JmrDSPercent),
          spell.cast("Raise Dead", req => me.inCombat() && me.target),
          spell.cast("Reaper's Mark"),
          spell.cast("Icebound Fortitude", on => me, req => (!me.hasVisibleAura("Dancing Rune Weapon") && !me.hasVisibleAura("Vampiric Blood") && me.pctHealth < Settings.JmrIBFSetting) || me.isStunned()),
          spell.cast("Lichborne", on => me, req => me.isFeared() || me.pctHealth < Settings.JmrLichborneSetting),
          spell.cast("Vampiric Blood", on => me, req => (!me.hasVisibleAura("Dancing Rune Weapon") && !me.hasVisibleAura("Icebound Fortitude") && !me.hasVisibleAura("Vampiric Blood") && me.pctHealth < Settings.JmrVBSetting) || me.isStunned()),
          spell.cast("Death's Caress", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Bone Shield")),
          spell.cast("Death and Decay", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Death and Decay")),
          spell.cast("Death Strike", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Coagulopathy") || !me.hasVisibleAura("Icy Talons") || me.powerByType(PowerType.RunicPower) >= Settings.JmrDeathStrikeDumpAmount || this.runicPowerDeficit() <= 20 || me.target.timeToDeath() < 10),
          spell.cast("Blooddrinker", req => !me.hasVisibleAura("Dancing Rune Weapon")),
          spell.cast("Sacrificial Pact", req => !me.hasVisibleAura("Dancing Rune Weapon") && (spell.getCooldown("Raise Dead").timeleft < 2000 || me.target.timeToDeath() < 1.5)),
          spell.cast("Blood Tap", req => (me.powerByType(PowerType.Runes) <= 2 && spell.getCharges("Blood Tap") >= 2) || me.powerByType(PowerType.Runes) < 3),
          spell.cast("Gorefiend's Grasp", req => me.hasAura("Tightening Grasp")),
          spell.cast("Empower Rune Weapon", req => me.powerByType(PowerType.Runes) < 6 && this.runicPowerDeficit() > 5),
          spell.cast("Dancing Rune Weapon", req => this.shouldUseDRW()),
          this.useRacials(),
          spell.cast("Arcane Torrent", on => me, req => me.powerByType(PowerType.RunicPower) < 80),
          new bt.Decorator(
            () => this.getEnemiesInRange(12) >= 1 && me.hasVisibleAura("Dancing Rune Weapon"),
            new bt.Selector(
              this.drw_up(),
              new bt.Action(() => bt.Status.Success)
            )
          ),
          new bt.Decorator(
            () => this.getEnemiesInRange(12) >= 1,
            new bt.Selector(
              this.standard(),
              new bt.Action(() => bt.Status.Success)
            )
          ),
        ),
      )
    );
  }

  drw_up() {
    return new bt.Selector(
      spell.cast("Blood Boil", on => this.getCurrentTarget(), req => !this.getCurrentTarget().hasVisibleAuraByMe("Blood Plague")),
      spell.cast("Tombstone", on => me, req => this.getAuraStacks("Bone Shield") > 5 && me.powerByType(PowerType.Runes) >= 2 && this.runicPowerDeficit() >= 30 && (!me.hasAura("Shattering Bone") || (me.hasAura("Shattering Bone") && me.hasVisibleAura("Death and Decay")))),
      spell.cast("Death Strike", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Coagulopathy") || !me.hasVisibleAura("Icy Talons")),
      spell.cast("Marrowrend", on => me, req => !me.hasVisibleAura("Bone Shield") || (me.hasVisibleAura("Bone Shield") && this.getAuraRemaining("Bone Shield") <= 4000 || this.getAuraStacks("Bone Shield") < this.bone_shield_refresh_value()) && this.runicPowerDeficit() > 20),
      spell.cast("Soul Reaper", on => this.getCurrentTarget(), req => combat.targets.length === 1 && me.target.timeToDeath() > (me.target.hasVisibleAuraByMe("Soul Reaper") ? this.getDebuffRemainingTime("Soul Reaper") + 5000 : 5000)),
      spell.cast("Soul Reaper", on => this.getCurrentTarget(), req => combat.targets.length >= 2 && me.target.timeToDeath() > (me.target.hasVisibleAuraByMe("Soul Reaper") ? this.getDebuffRemainingTime("Soul Reaper") + 5000 : 5000)),
      spell.cast("Death and Decay", on => this.getCurrentTarget(), req => (!me.hasVisibleAura("Death and Decay") && (me.hasAura("Sanguine Ground") || me.hasAura("Unholy Ground"))) && !me.isMoving()),
      spell.cast("Blood Boil", on => this.getCurrentTarget(), req => me.getUnitsAroundCount(10) > 2 && spell.getCharges("Blood Boil") >= 1),
      spell.cast("Death Strike", on => this.getCurrentTarget(), req => this.runicPowerDeficit() <= this.heartStrikeRpDrw() || me.powerByType(PowerType.RunicPower) >= Settings.JmrDeathStrikeDumpAmount),
      spell.cast("Consumption", on => this.getCurrentTarget(), req => this.getCurrentTarget() !== undefined),
      spell.cast("Blood Boil", on => this.getCurrentTarget(), req => spell.getCharges("Blood Boil") >= 1 && this.getAuraStacks("Hemostasis") < 5),
      spell.cast("Heart Strike", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Runes) >= 2 || this.runicPowerDeficit() >= this.heartStrikeRpDrw()),
    );
  }

  standard() {
    return new bt.Selector(
      spell.cast("Tombstone", on => me, req => this.getAuraStacks("Bone Shield") > 5 && me.powerByType(PowerType.Runes) >= 2 && this.runicPowerDeficit() >= 30 && (!me.hasAura("Shattering Bone") || (me.hasAura("Shattering Bone") && me.hasVisibleAura("Death and Decay"))) && spell.getCooldown("Dancing Rune Weapon").timeleft >= 25000),
      spell.cast("Death Strike", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Coagulopathy") || !me.hasVisibleAura("Icy Talons") || me.powerByType(PowerType.RunicPower) >= Settings.JmrDeathStrikeDumpAmount || this.runicPowerDeficit() <= this.heartStrikeRp() || me.target.timeToDeath() < 10),
      spell.cast("Death's Caress", on => this.getCurrentTarget(), req => (me.hasVisibleAura("Bone Shield") && this.getAuraRemaining("Bone Shield") <= 4000 || this.getAuraStacks("Bone Shield") < this.bone_shield_refresh_value() + 1) && this.runicPowerDeficit() > 10 && !(me.hasAura("Insatiable Blade") && spell.getCooldown("Dancing Rune Weapon").timeleft < this.getAuraRemaining("Bone Shield")) && !me.hasAura("Consumption") && !me.hasAura("Blooddrinker") && me.powerByType(PowerType.Runes) < 3),
      spell.cast("Marrowrend", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Bone Shield") || (me.hasVisibleAura("Bone Shield") && this.getAuraRemaining("Bone Shield") <= 4000 || this.getAuraStacks("Bone Shield") < this.bone_shield_refresh_value()) && this.runicPowerDeficit() > 20 && !(me.hasAura("Insatiable Blade") && spell.getCooldown("Dancing Rune Weapon").timeleft < this.getAuraRemaining("Bone Shield"))),
      spell.cast("Consumption", on => this.getCurrentTarget(), req => this.getCurrentTarget() !== undefined),
      spell.cast("Soul Reaper", on => this.getCurrentTarget(), req => combat.targets.length === 1 && me.target.timeToDeath() > (me.target.hasVisibleAuraByMe("Soul Reaper") ? this.getDebuffRemainingTime("Soul Reaper") + 5000 : 5000)),
      spell.cast("Soul Reaper", on => this.getCurrentTarget(), req => combat.targets.length >= 2 && me.target.timeToDeath() > (me.target.hasVisibleAuraByMe("Soul Reaper") ? this.getDebuffRemainingTime("Soul Reaper") + 5000 : 5000)),
      spell.cast("Bonestorm", on => me, req => this.getAuraStacks("Bone Shield") >= 5),
      spell.cast("Blood Boil", on => this.getCurrentTarget(), req => spell.getCharges("Blood Boil") >= 2 && (this.getAuraStacks("Hemostasis") <= (5 - me.getUnitsAroundCount(10)) || me.getUnitsAroundCount(10) > 2)),
      spell.cast("Heart Strike", on => this.getCurrentTarget(), req => me.powerByType(PowerType.Runes) >= 4),
      spell.cast("Blood Boil", on => this.getCurrentTarget(), req => spell.getCharges("Blood Boil") >= 1 && this.getCurrentTarget()),
      spell.cast("Heart Strike", on => this.getCurrentTarget() , req => me.powerByType(PowerType.Runes) > 1 && (me.powerByType(PowerType.Runes) >= 3 || this.getAuraStacks("Bone Shield") > 7)),
    );
  }

  shouldUseDRW() {
    const target = this.getCurrentTarget();
    return target.timeToDeath() > Settings.JmrDRWTTD && !me.hasAura("Smothering Shadows");
  }

  // Racial abilities
  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, req => me.race === RaceType.Orc),
    );
  }


  bone_shield_refresh_value() {
    return me.hasAura("Consumption") || me.hasAura("Blooddrinker") ? 4 : 5;
  }

  heartStrikeRpDrw() {
    return 25 + me.getUnitsAroundCount(10) * (me.hasAura("Heartbreaker") ? 2 : 0);
  }

  heartStrikeRp() {
    return 10 + me.getUnitsAroundCount(10) * (me.hasAura("Heartbreaker") ? 2 : 0);
  }

  runicPowerDeficit() {
    return me.maxPowerByType(PowerType.RunicPower) - me.powerByType(PowerType.RunicPower);
  }

  UnitsAroundMissingBloodPlague() {
    return me.getUnitsAround(10).filter(unit => !unit.hasVisibleAuraByMe("Blood Plague")).length > 0;
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || me.targetUnit;
  }

  getValidTarget(predicate) {
    return combat.targets.find(predicate) || (me.targetUnit && predicate(me.targetUnit) ? me.targetUnit : undefined);
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getAuraRemaining(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    const debuff = target ? target.getAura(debuffName) : null;
    return debuff ? debuff.remaining : 0;
  }

  getDebuffStacks(debuffName) {
    const target = this.getCurrentTarget();
    const debuff = target ? target.getAura(debuffName) : null;
    return debuff ? debuff.stacks : 0;
  }

  getAuraStacks(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.stacks : 0;
  }
}
