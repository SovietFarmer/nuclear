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

const auras = {
  dancing_rune_weapon: 81256,
  essence_of_the_blood_queen: 433925,
  vampiric_strike_proc: 433899,
  vampiric_strike_talent: 433901,
  exterminate: 441378,
  blood_plague: 55078,
};

export class DeathKnightBloodBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Blood;
  name = "Jmr Blood DK (Midnight)";

  static settings = [
    { header: "Jmr Blood DK Settings (Midnight)" },
    { header: "" },
    { header: "Auto Taunt" },
    { type: "checkbox", uid: "JmrADC", text: "Auto Dark Command", default: false },
    { type: "checkbox", uid: "JmrADG", text: "Auto Death Grip", default: false },
    { header: "" },
    { header: "Defensive Cooldowns" },
    { type: "slider", uid: "JmrDSPercent", text: "Death Strike Health Percent", min: 0, max: 100, default: 75 },
    { type: "slider", uid: "JmrRuneTapSetting", text: "Rune Tap Health Percent", min: 0, max: 100, default: 65 },
    { type: "slider", uid: "JmrIBFSetting", text: "Icebound Fortitude Health Percent", min: 0, max: 100, default: 40 },
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
    this.eventListener = new wow.EventListener();
    this.eventListener.onEvent = (event) => {
      if (event.name === "COMBAT_LOG_EVENT_UNFILTERED") {
        this.handleCombatLogEvent(event);
      }
    };
  }

  handleCombatLogEvent(event) {
    if (typeof event.args !== 'object') return;
    if (event.args.length === 0) return;

    const eventData = event.args[0];
    const subEvent = eventData.eventType || eventData[1];
    const destName = eventData.destination?.name || "Unknown Target";
    const spellID = eventData.args ? eventData.args[0] : undefined;
    const spellSchool = eventData.args ? eventData.args[90] : undefined;

    if (subEvent === 5 && destName === me.name && spellSchool !== 0 && spellSchool !== 1) {
      const sourceUnit = objMgr.findObject(eventData.source?.guid);
      if (sourceUnit instanceof wow.CGUnit && sourceUnit.inCombatWithMe) {
        const spellInfo = sourceUnit.spellInfo;
        if (spellInfo && spellInfo.cast !== 0) {
          this.lastEnemyCast = {
            spellID,
            sourceName: eventData.source?.name || "Unknown",
            sourceUnit,
            castStart: wow.frameTime,
            castEnd: spellInfo.castEnd
          };
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
        return true;
      }
    }
    return false;
  }

  isSanlayn() {
    return me.hasAura(auras.vampiric_strike_talent);
  }

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCastOrChannel(),

          // --- Utility ---
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

          // --- Auto Taunt ---
          spell.cast("Dark Command",
            on => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()),
            req => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()) !== undefined && Settings.JmrADC
          ),
          spell.cast("Death Grip",
            on => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()),
            req => this.getValidTarget(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()) !== undefined
              && spell.getCharges("Death Grip") > Settings.JmrDeathGripCharges
              && spell.getCharges("Death Grip") >= 1
              && Settings.JmrADG
          ),

          // --- Wait for combat before CDs/rotation ---
          common.waitForCombat(),

          // --- AoE Blood Plague emergency ---
          spell.cast("Blood Boil",
            on => me,
            req => me.getUnitsAroundCount(10) > 3 && spell.getCharges("Blood Boil") >= 1 && this.UnitsAroundMissingBloodPlague()
          ),

          // --- Defensives ---
          spell.cast("Rune Tap", on => me, req => me.inCombat() && me.pctHealth < Settings.JmrRuneTapSetting && !me.hasVisibleAura("Rune Tap")),
          spell.cast("Death Strike", on => this.getCurrentTarget(), req => me.pctHealth < Settings.JmrDSPercent),
          spell.cast("Icebound Fortitude", on => me, req =>
            (!me.hasVisibleAura(auras.dancing_rune_weapon) && !me.hasVisibleAura("Vampiric Blood") && me.pctHealth < Settings.JmrIBFSetting) || me.isStunned()
          ),
          spell.cast("Lichborne", on => me, req => me.isFeared() || me.pctHealth < Settings.JmrLichborneSetting),

          // --- high_prio_actions ---
          spell.cast("Raise Dead", req => me.inCombat() && me.target),
          spell.cast("Death Strike", on => this.getCurrentTarget(), req => {
            const coag = me.getAura("Coagulopathy");
            return coag && coag.remaining > 0 && coag.remaining <= 1500;
          }),

          // Vampiric Blood - max uptime
          spell.cast("Vampiric Blood", on => me, req => !me.hasVisibleAura("Vampiric Blood")),

          // Dancing Rune Weapon
          spell.cast("Dancing Rune Weapon", req => this.shouldUseDRW()),

          // Racials + Arcane Torrent + Trinkets
          this.useRacials(),
          spell.cast("Arcane Torrent", on => me, req => this.runicPowerDeficit() > 20),
          common.useTrinkets(() => this.getCurrentTarget()),

          // --- Hero tree rotation routing (melee range gated) ---
          new bt.Decorator(
            () => this.getEnemiesInRange(12) >= 1,
            new bt.Selector(
              // San'layn during DRW (Gift of the San'layn window)
              new bt.Decorator(
                () => this.isSanlayn() && me.hasVisibleAura(auras.dancing_rune_weapon),
                this.sanGift()
              ),
              // San'layn default (also fallback when sanGift can't cast anything)
              new bt.Decorator(
                () => this.isSanlayn(),
                this.sanlayn()
              ),
              // Deathbringer
              new bt.Decorator(
                () => !this.isSanlayn(),
                this.deathbringer()
              ),
            )
          ),
        ),
      )
    );
  }

  // San'layn rotation during DRW (Gift of the San'layn window)
  // During Gift/DRW, all Heart Strikes become Vampiric Strikes
  sanGift() {
    return new bt.Selector(
      // Death Strike at 75+ RP
      spell.cast("Death Strike", on => this.getCurrentTarget(), req => this.runicPowerDeficit() < 50),
      // Bone Shield maintenance (at least 5 stacks)
      spell.cast("Marrowrend", on => this.getCurrentTarget(), req => {
        const bs = me.getAura("Bone Shield");
        return !bs || bs.stacks < 5 || bs.remaining < 3000;
      }),
      // Blood Boil if DRW Blood Plague copy not ticking on target
      spell.cast("Blood Boil", on => me, req => {
        const target = this.getCurrentTarget();
        return target && !target.hasVisibleAuraByMe(auras.blood_plague);
      }),
      // Death and Decay on Crimson Scourge proc
      spell.cast("Death and Decay", on => this.getCurrentTarget(), req => me.hasVisibleAura("Crimson Scourge")),
      // Fill with Vampiric Strike
      spell.cast("Vampiric Strike", on => this.getCurrentTarget()),
      // Heart Strike fallback
      spell.cast("Heart Strike", on => this.getCurrentTarget()),
      // Out of runes — Blood Boil
      spell.cast("Blood Boil", on => me),
    );
  }

  // San'layn rotation outside DRW
  sanlayn() {
    return new bt.Selector(
      // Death Strike at 75+ RP
      spell.cast("Death Strike", on => this.getCurrentTarget(), req => this.runicPowerDeficit() < 50),
      // Bone Shield emergency (about to expire, rune-efficient)
      spell.cast("Death's Caress", on => this.getCurrentTarget(), req => {
        const bs = me.getAura("Bone Shield");
        return (!bs || bs.remaining < 3000 || bs.stacks <= 1) && me.powerByType(PowerType.Runes) < 4;
      }),
      // Bone Shield maintenance (at least 5 stacks, or about to expire)
      spell.cast("Marrowrend", on => this.getCurrentTarget(), req => {
        const bs = me.getAura("Bone Shield");
        return !bs || bs.stacks < 5 || bs.remaining < 3000;
      }),
      // Death and Decay uptime or Crimson Scourge proc
      spell.cast("Death and Decay", on => this.getCurrentTarget(), req =>
        !me.hasVisibleAura("Death and Decay") || me.hasVisibleAura("Crimson Scourge")
      ),
      // Blood Boil with Boiling Point proc
      spell.cast("Blood Boil", on => me, req => me.hasVisibleAura("Boiling Point")),
      // Vampiric Strike when proc available
      spell.cast("Vampiric Strike", on => this.getCurrentTarget(), req => me.hasAura(auras.vampiric_strike_proc)),
      // Blood Boil to prevent charge capping
      spell.cast("Blood Boil", on => me, req => spell.getCharges("Blood Boil") >= 2),
      // Heart Strike filler
      spell.cast("Heart Strike", on => this.getCurrentTarget()),
    );
  }

  // Deathbringer rotation
  deathbringer() {
    return new bt.Selector(
      // Death Strike at near-cap RP (lower threshold during DRW)
      spell.cast("Death Strike", on => this.getCurrentTarget(), req =>
        this.runicPowerDeficit() < 20 || (this.runicPowerDeficit() < 26 && me.hasVisibleAura(auras.dancing_rune_weapon))
      ),
      // Death and Decay uptime
      spell.cast("Death and Decay", on => this.getCurrentTarget(), req => !me.hasVisibleAura("Death and Decay")),
      // Reaper's Mark
      spell.cast("Reaper's Mark", on => this.getCurrentTarget()),
      // Marrowrend with Exterminate proc
      spell.cast("Marrowrend", on => this.getCurrentTarget(), req => me.hasAura(auras.exterminate)),
      // Death's Caress for Bone Shield (rune-efficient when low on runes)
      spell.cast("Death's Caress", on => this.getCurrentTarget(), req => {
        const bs = me.getAura("Bone Shield");
        return (!bs || bs.remaining < 3000 || bs.stacks < 6) && me.powerByType(PowerType.Runes) < 4;
      }),
      // Marrowrend for Bone Shield maintenance
      spell.cast("Marrowrend", on => this.getCurrentTarget(), req => {
        const bs = me.getAura("Bone Shield");
        return !bs || bs.remaining < 3000 || bs.stacks < 6;
      }),
      // Death Strike dump
      spell.cast("Death Strike", on => this.getCurrentTarget()),
      // Blood Boil
      spell.cast("Blood Boil", on => me),
      // Consumption (basic cast, not during DRW)
      spell.cast("Consumption", on => this.getCurrentTarget(), req => !me.hasVisibleAura(auras.dancing_rune_weapon)),
      // Heart Strike filler
      spell.cast("Heart Strike", on => this.getCurrentTarget()),
      // Consumption (lowest priority fallback)
      spell.cast("Consumption", on => this.getCurrentTarget()),
      // Arcane Torrent for RP
      spell.cast("Arcane Torrent", on => me, req => this.runicPowerDeficit() > 20),
    );
  }

  shouldUseDRW() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    if (me.hasVisibleAura(auras.dancing_rune_weapon)) return false;
    if (target.timeToDeath() < Settings.JmrDRWTTD) return false;
    if (!this.isSanlayn()) {
      if (me.hasAura(auras.exterminate)) return false;
      if (target.hasAuraByMe("Reaper's Mark")) return false;
    }
    return true;
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, req => me.race === RaceType.Orc),
      spell.cast("Berserking", on => me, req => me.race === RaceType.Troll),
      spell.cast("Fireblood", on => me, req => me.race === RaceType.DarkIronDwarf),
      spell.cast("Ancestral Call", on => me, req => me.race === RaceType.MagharOrc),
    );
  }

  runicPowerDeficit() {
    return me.maxPowerByType(PowerType.RunicPower) - me.powerByType(PowerType.RunicPower);
  }

  UnitsAroundMissingBloodPlague() {
    return me.getUnitsAround(10).filter(unit => !unit.hasVisibleAuraByMe(auras.blood_plague)).length > 0;
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
