import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from "@/Core/BehaviorTree";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import { pvpHelpers } from "@/Data/PVPData";
import drTracker from "@/Core/DRTracker";
import { RaceType } from "@/Enums/UnitEnums";
import Settings from "@/Core/Settings";

const auras = {
  battleShout: 6673,
  suddenDeath: 52437,
  hamstring: 1715,
  piercingHowlSlow: 12323,
  /** Colossal Might (stacking buff w/ duration) — not 429634 (name collision, 0ms in log). */
  colossalMight: 440989,
  /** Tactician proc buff — talent may also show as "Tactician"; use ID so Slam dump isn’t blocked forever. */
  tacticianProc: 199854,
  /** Master of Warfare stack buff w/ duration — Slam becomes Heroic Strike (not 1269307, 0ms in log). */
  masterOfWarfareProc: 1269394,
};

/**
 * Arms PvP (Midnight): Colossus + Slayer-friendly priority list.
 * Style matches `WarriorFuryPvP` (burst toggle, pvpAlwaysPerform, interrupt off-GCD).
 * Dropped from pre-Midnight JMR SIMC: Thunderous Roar, Ravager/Bonegrinder, Colossal Might 10-stack gate for every burst button.
 * Added: Heroic Strike proc priority, Master of Warfare (1269394) rage dump → HS instead of Slam, Demolish (Colossus), Tactician proc (199854), Fervor Whirlwind consume.
 */
export class WarriorArmsPvP extends Behavior {
  name = "Warrior (Arms) PvP";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Arms;
  version = wow.GameVersion.Retail;

  static settings = [
    {
      header: "PvP",
      options: [
        { type: "slider", uid: "DefensiveStanceHealthPct", text: "Defensive Stance Health %", min: 20, max: 80, default: 55 },
        { type: "checkbox", uid: "UseHamstring", text: "Use Hamstring for Movement Control", default: true },
        { type: "checkbox", uid: "UseSweepingStrikes", text: "Use Sweeping Strikes (2+ enemies)", default: true },
        { type: "checkbox", uid: "UseChampionsSpear", text: "Use Champion's Spear in Burst", default: true },
        { type: "checkbox", uid: "UsePiercingHowl", text: "Use Piercing Howl", default: true },
        { type: "checkbox", uid: "UseProtectiveIntervene", text: "Intervene healer (rogue CC / Hunter stun)", default: true },
      ],
    },
    {
      header: "Defensive Abilities",
      options: [
        { type: "checkbox", uid: "UseIgnorePain", text: "Use Ignore Pain", default: true },
        { type: "slider", uid: "IgnorePainHealthPct", text: "Ignore Pain Health %", min: 50, max: 95, default: 88 },
        { type: "slider", uid: "IgnorePainRage", text: "Ignore Pain Min Rage", min: 40, max: 100, default: 60 },
        { type: "checkbox", uid: "UseRallyingCry", text: "Use Rallying Cry", default: true },
        { type: "slider", uid: "RallyingCryHealthPct", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
        { type: "checkbox", uid: "UseDieByTheSword", text: "Use Die by the Sword", default: true },
        { type: "slider", uid: "DieByTheSwordHealthPct", text: "Die by the Sword Health %", min: 10, max: 50, default: 35 },
        { type: "checkbox", uid: "UseImpendingVictory", text: "Use Impending Victory / Victory Rush", default: true },
        { type: "slider", uid: "ImpendingVictoryHealthPct", text: "Impending Victory HP % (healer up)", min: 50, max: 90, default: 72 },
        { type: "slider", uid: "ImpendingVictoryNoHealerHealthPct", text: "Impending Victory HP % (no healer)", min: 60, max: 95, default: 82 },
      ],
    },
    {
      header: "Major Cooldowns",
      options: [
        { type: "checkbox", uid: "UseAvatar", text: "Use Avatar", default: true },
        { type: "checkbox", uid: "UseWarbreaker", text: "Use Warbreaker", default: true },
        { type: "checkbox", uid: "UseColossusSmash", text: "Use Colossus Smash", default: true },
      ],
    },
    {
      header: "Racials",
      options: [{ type: "checkbox", uid: "BurstIncludeBloodFury", text: "Include Blood Fury in Burst", default: true }],
    },
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.waitForFacing(),
      spell.interrupt("Pummel", true),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotWaitingForArenaToStart(),
          common.waitForCombat(),
          this.pvpAlwaysPerform(),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstRotation()
          ),
          this.sustainedDamage()
        )
      )
    );
  }

  /**
   * Shout → stances → shatter → reflect → hamstring → defensives → CC when not bursting → piercing howl.
   */
  pvpAlwaysPerform() {
    return new bt.Selector(
      spell.cast("Battle Shout", () => this.shouldCastBattleShoutPVP()),
      spell.cast("Defensive Stance", () => me.pctHealth < Settings.DefensiveStanceHealthPct && !me.hasAura("Defensive Stance")),
      spell.cast("Battle Stance", () => me.pctHealth >= Settings.DefensiveStanceHealthPct && !me.hasAura("Battle Stance")),
      spell.cast("Shattering Throw", on => this.findShatteringThrowTarget(), ret => this.findShatteringThrowTarget() !== null),
      spell.cast(23920, () => this.shouldSpellReflectPVP()),
      spell.cast("Hamstring", () => this.shouldHamstringCast()),
      this.pvpDefensives(),
      new bt.Decorator(
        ret => !this.shouldUseBurstAbility(),
        new bt.Selector(
          spell.cast(236077, on => this.findDisarmTarget(), ret => this.findDisarmTarget() !== null),
          spell.cast("Shockwave", on => this.findShockwaveUtilityTarget(), ret => spell.isSpellKnown("Shockwave") && this.findShockwaveUtilityTarget() !== null),
          spell.cast("Storm Bolt", on => this.findStormBoltCCTarget(), ret => this.findStormBoltCCTarget() !== null),
          spell.cast("Intimidating Shout", on => this.findIntimidatingShoutTarget(), ret => this.findIntimidatingShoutTarget() !== null)
        ),
        new bt.Action(() => bt.Status.Success)
      ),
      spell.cast("Intervene", on => this.findHealerUnderRogueCC(), ret => Settings.UseProtectiveIntervene && this.findHealerUnderRogueCC() !== null),
      spell.cast("Intervene", on => this.findHealerUnderHunterStun(), ret => Settings.UseProtectiveIntervene && this.findHealerUnderHunterStun() !== null),
      spell.cast("Piercing Howl", () => Settings.UsePiercingHowl && this.shouldCastPiercingHowl()),
      new bt.Action(() => bt.Status.Failure)
    );
  }

  pvpDefensives() {
    return new bt.Selector(
      spell.cast("Battle Shout", () => !me.hasAura(auras.battleShout)),
      spell.cast("Ignore Pain", () =>
        Settings.UseIgnorePain &&
        spell.isSpellKnown("Ignore Pain") &&
        me.pctHealth < Settings.IgnorePainHealthPct &&
        me.powerByType(PowerType.Rage) >= Settings.IgnorePainRage &&
        !me.hasAura("Ignore Pain")
      ),
      spell.cast("Die by the Sword", () =>
        Settings.UseDieByTheSword &&
        spell.isSpellKnown("Die by the Sword") &&
        me.pctHealth < Settings.DieByTheSwordHealthPct &&
        this.shouldUseDieByTheSword()
      ),
      spell.cast("Impending Victory", () => Settings.UseImpendingVictory && spell.isSpellKnown("Impending Victory") && this.shouldUseImpendingVictory()),
      spell.cast("Victory Rush", () =>
        Settings.UseImpendingVictory &&
        !spell.isSpellKnown("Impending Victory") &&
        spell.isSpellKnown("Victory Rush") &&
        this.shouldUseImpendingVictory()
      ),
      spell.cast("Rallying Cry", () => Settings.UseRallyingCry && me.pctHealth < Settings.RallyingCryHealthPct),
      new bt.Action(() => bt.Status.Failure)
    );
  }

  burstRotation() {
    return new bt.Selector(
      this.useRacials(),
      spell.cast("Storm Bolt", on => this.findHealerForStunCC(), ret => this.findHealerForStunCC() !== null),
      spell.cast("Storm Bolt", on => this.getCurrentTargetPVP(), ret => this.shouldStormBoltCurrentTarget() && this.shouldUseBurstAbility()),
      spell.cast("Shockwave", on => this.findShockwaveBurstTarget(), ret => spell.isSpellKnown("Shockwave") && this.findShockwaveBurstTarget() !== null),
      spell.cast("Avatar", ret => Settings.UseAvatar && spell.isSpellKnown("Avatar") && this.shouldUseBurstAbility()),
      spell.cast("Warbreaker", ret => Settings.UseWarbreaker && spell.isSpellKnown("Warbreaker") && this.shouldUseBurstAbility()),
      spell.cast("Colossus Smash", ret => Settings.UseColossusSmash && spell.isSpellKnown("Colossus Smash") && this.shouldUseBurstAbility()),
      spell.cast("Champion's Spear", on => this.getCurrentTargetPVP(), ret => Settings.UseChampionsSpear && spell.isSpellKnown("Champion's Spear") && this.shouldUseBurstAbility()),
      spell.cast("Sharpened Blade", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Sharpened Blade") && this.isSlayerBuild() && this.shouldUseBurstAbility()),
      spell.cast("Sharpen Blade", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Sharpen Blade") && this.isSlayerBuild() && this.shouldUseBurstAbility()),
      spell.cast("Demolish", on => this.getCurrentTargetPVP(), ret => this.shouldCastDemolishBurst()),
      spell.cast("Whirlwind", on => this.getCurrentTargetPVP(), ret => this.shouldWhirlwindConsumeHeroic()),
      spell.cast("Heroic Strike", on => this.getCurrentTargetPVP(), ret => this.hasHeroicStrikeProc()),
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), ret => this.targetMissingCriticalDebuffs()),
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP()),
      spell.cast("Execute", on => this.getCurrentTargetPVP(), ret => this.shouldExecuteNow()),
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Bladestorm")),
      spell.cast("Heroic Strike", on => this.getCurrentTargetPVP(), ret => this.shouldRageDumpHeroicStrike()),
      spell.cast("Slam", on => this.getCurrentTargetPVP(), ret => this.shouldSlamDump()),
      spell.cast("Overpower", on => this.getCurrentTargetPVP()),
      this.sustainedDamage()
    );
  }

  sustainedDamage() {
    return new bt.Selector(
      spell.cast("Sweeping Strikes", () =>
        Settings.UseSweepingStrikes && spell.isSpellKnown("Sweeping Strikes") && this.getEnemiesInRange(8) >= 2 && !me.hasAura("Sweeping Strikes")
      ),
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP(), ret => this.targetMissingCriticalDebuffs()),
      spell.cast("Rend", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Rend") && !this.getCurrentTargetPVP()?.hasAuraByMe("Rend")),
      spell.cast("Demolish", on => this.getCurrentTargetPVP(), ret => this.shouldCastDemolishSustained()),
      spell.cast("Whirlwind", on => this.getCurrentTargetPVP(), ret => this.shouldWhirlwindConsumeHeroic()),
      spell.cast("Heroic Strike", on => this.getCurrentTargetPVP(), ret => this.hasHeroicStrikeProc()),
      spell.cast("Mortal Strike", on => this.getCurrentTargetPVP()),
      spell.cast("Execute", on => this.getCurrentTargetPVP(), ret => this.shouldExecuteNow()),
      spell.cast("Bladestorm", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Bladestorm")),
      spell.cast("Heroic Strike", on => this.getCurrentTargetPVP(), ret => this.shouldRageDumpHeroicStrike()),
      spell.cast("Slam", on => this.getCurrentTargetPVP(), ret => this.shouldSlamDump()),
      spell.cast("Overpower", on => this.getCurrentTargetPVP()),
      spell.cast("Thunder Clap", on => this.getCurrentTargetPVP(), ret => this.getEnemiesInRange(8) >= 3 && this.getEnemiesWithoutRend() >= 3),
      spell.cast("Rend", on => this.getNearbyEnemyWithoutRend(), ret => this.getEnemiesInRange(8) < 3 && this.getNearbyEnemyWithoutRend() !== null),
      spell.cast("Whirlwind", on => this.getCurrentTargetPVP(), ret => this.shouldFervorWhirlwindFiller()),
      spell.cast("Heroic Strike", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Heroic Strike") && this.hasMasterOfWarfareProc()),
      spell.cast("Slam", on => this.getCurrentTargetPVP(), ret => spell.isSpellKnown("Slam") && !this.hasMasterOfWarfareProc())
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, ret => me.race === RaceType.Orc && (!Settings.BurstIncludeBloodFury || this.shouldUseBurstAbility()))
    );
  }

  shouldUseBurstAbility() {
    return Combat.burstToggle;
  }

  hasCooldownsReady() {
    return (
      Combat.burstToggle &&
      me.target &&
      me.isWithinMeleeRange(me.target) &&
      ((Settings.UseAvatar && spell.isSpellKnown("Avatar") && !spell.isOnCooldown("Avatar")) ||
        (Settings.UseWarbreaker && spell.isSpellKnown("Warbreaker") && !spell.isOnCooldown("Warbreaker")) ||
        (Settings.UseColossusSmash && spell.isSpellKnown("Colossus Smash") && !spell.isOnCooldown("Colossus Smash")))
    );
  }

  hasTalent(name) {
    return me.hasAura(name);
  }

  isColossusBuild() {
    return spell.isSpellKnown("Demolish");
  }

  isSlayerBuild() {
    return this.hasTalent("Slayer's Dominance");
  }

  colossalMightStacks() {
    const n = me.getAuraStacks(auras.colossalMight);
    return typeof n === "number" ? n : 0;
  }

  hasSmashDebuffOn(unit) {
    if (!unit) return false;
    return Boolean(unit.hasAuraByMe("Colossus Smash") || unit.hasAuraByMe("Warbreaker"));
  }

  /**
   * Proc detection — if Heroic Strike never fires, dump a combat-log buff name into auras / hasAura here.
   */
  hasHeroicStrikeProc() {
    if (!spell.isSpellKnown("Heroic Strike")) return false;
    return me.hasAura("Heroic Strike") || me.hasAura("Improved Heroic Strike");
  }

  /** Apex MoW: timed buff; treat Slam rage-dump windows as Heroic Strike instead. */
  hasMasterOfWarfareProc() {
    return Boolean(me.getAura(auras.masterOfWarfareProc));
  }

  /** Same gates as Slam dump, but when Master of Warfare converts Slam → Heroic Strike. */
  shouldRageDumpHeroicStrike() {
    if (!spell.isSpellKnown("Heroic Strike")) return false;
    if (!this.hasMasterOfWarfareProc()) return false;
    if (me.powerByType(PowerType.Rage) <= 50) return false;
    if (this.hasTacticianProc()) return false;
    return true;
  }

  shouldWhirlwindConsumeHeroic() {
    if (!this.hasTalent("Fervor of Battle") || !spell.isSpellKnown("Whirlwind")) return false;
    if (!this.hasHeroicStrikeProc() && !this.hasMasterOfWarfareProc()) return false;
    return this.getEnemiesInRange(8) >= 2;
  }

  /** Fervor filler only in cleave — ST rage dump is Slam, not WW. */
  shouldFervorWhirlwindFiller() {
    if (!this.hasTalent("Fervor of Battle") || !spell.isSpellKnown("Whirlwind")) return false;
    return this.getEnemiesInRange(8) >= 2;
  }

  /** True while the spendable Tactician proc is up (not the passive talent aura). */
  hasTacticianProc() {
    return Boolean(me.getAura(auras.tacticianProc));
  }

  shouldSlamDump() {
    if (!spell.isSpellKnown("Slam")) return false;
    if (this.hasMasterOfWarfareProc()) return false;
    if (me.powerByType(PowerType.Rage) <= 50) return false;
    if (this.hasTacticianProc()) return false;
    return true;
  }

  /** Demolish is channeled — only when kill target is stunned or rooted (CGUnit flags). */
  isDemolishTargetControlled(unit) {
    if (!unit) return false;
    return unit.isStunned() || unit.isRooted();
  }

  shouldCastDemolishBurst() {
    if (!spell.isSpellKnown("Demolish") || !this.isColossusBuild()) return false;
    const t = this.getCurrentTargetPVP();
    if (!t || !this.isDemolishTargetControlled(t)) return false;
    const stacks = this.colossalMightStacks();
    if (stacks < 4 && !this.hasSmashDebuffOn(t)) return false;
    return true;
  }

  shouldCastDemolishSustained() {
    if (!spell.isSpellKnown("Demolish") || !this.isColossusBuild()) return false;
    const t = this.getCurrentTargetPVP();
    if (!t || !this.isDemolishTargetControlled(t)) return false;
    const stacks = this.colossalMightStacks();
    if (this.hasSmashDebuffOn(t) && stacks >= 4) return true;
    if (stacks >= 8) return true;
    return false;
  }

  isExecutePhase(unit) {
    if (!unit) return false;
    return (this.hasTalent("Massacre") && unit.pctHealth < 35) || unit.pctHealth < 20;
  }

  shouldExecuteNow() {
    const t = this.getCurrentTargetPVP();
    if (!t) return false;
    if (this.isExecutePhase(t)) return true;
    const sd = me.getAura("Sudden Death") || me.getAura(auras.suddenDeath);
    if (!sd) return false;
    if (this.hasSmashDebuffOn(t) || me.hasAura("Avatar")) return true;
    if (sd.remaining < 2500) return true;
    if (spell.isSpellKnown("Warbreaker")) {
      const cd = spell.getCooldown("Warbreaker");
      if (cd && cd.timeleft > 12000) return false;
    }
    return true;
  }

  getCurrentTargetPVP() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit) && !pvpHelpers.hasImmunity(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return Combat.targets.find(targetPredicate) || null;
  }

  targetMissingCriticalDebuffs() {
    const target = this.getCurrentTargetPVP();
    if (!target) return false;
    return !target.hasAuraByMe("Mortal Wounds") || !target.hasAuraByMe("Deep Wounds");
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getEnemiesWithoutRend() {
    return Combat.targets.filter(unit => me.distanceTo(unit) <= 8 && !unit.hasAuraByMe("Rend")).length;
  }

  getNearbyEnemyWithoutRend() {
    return Combat.targets.find(unit => me.distanceTo(unit) <= 8 && !unit.hasAuraByMe("Rend")) || null;
  }

  shouldCastBattleShoutPVP() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (!friend.deadOrGhost && !friend.hasAura(auras.battleShout)) {
        return true;
      }
    }
    return false;
  }

  shouldSpellReflectPVP() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo && target && target.equals(me.guid)) {
          const spellId = enemy.spellInfo.spellCastId;
          if (pvpHelpers.shouldReflectSpell(spellId)) {
            const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
            return castRemains < 1000;
          }
        }
      }
    }
    return false;
  }

  shouldHamstringCast() {
    if (!Settings.UseHamstring) return false;
    const target = this.getCurrentTargetPVP();
    if (!target) return false;
    if (target.hasAura(auras.hamstring) || target.hasAura(auras.piercingHowlSlow)) return false;
    if (pvpHelpers.hasImmunity(target)) return false;
    if (target.hasAura(1044)) return false;
    const lastSuccessfulTime = spell._lastSuccessfulCastTimes.get("hamstring");
    const now = wow.frameTime;
    const timeSinceSuccess = lastSuccessfulTime ? now - lastSuccessfulTime : 999999;
    if (lastSuccessfulTime && timeSinceSuccess < 12000) {
      return false;
    }
    return true;
  }

  findDisarmTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (
        enemy.isPlayer() &&
        me.isWithinMeleeRange(enemy) &&
        drTracker.getDRStacks(enemy.guid, "disarm") < 2 &&
        !pvpHelpers.hasImmunity(enemy) &&
        !enemy.isCCd()
      ) {
        const disarmableBuff = pvpHelpers.hasDisarmableBuff(enemy, false, 3);
        if (disarmableBuff) return enemy;
      }
    }
    return null;
  }

  findStormBoltCCTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (
        enemy.isPlayer() &&
        me.distanceTo(enemy) > 7 &&
        me.distanceTo(enemy) <= 30 &&
        drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
        !pvpHelpers.hasImmunity(enemy) &&
        !enemy.isCCd()
      ) {
        const majorCooldown = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
        if (majorCooldown) return enemy;
      }
    }
    return null;
  }

  isShockwaveEligibleTarget(enemy) {
    return (
      enemy &&
      enemy.isPlayer() &&
      me.distanceTo(enemy) <= 10 &&
      me.isFacing(enemy) &&
      enemy.canCC() &&
      drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
      !pvpHelpers.hasImmunity(enemy) &&
      !enemy.isCCd()
    );
  }

  findShockwaveBurstTarget() {
    const killTarget = this.getCurrentTargetPVP();
    if (this.isShockwaveEligibleTarget(killTarget)) {
      return killTarget;
    }
    const enemies = me.getEnemies();
    const eligible = enemies.filter(enemy => this.isShockwaveEligibleTarget(enemy));
    return eligible.length >= 2 ? eligible[0] : null;
  }

  findShockwaveUtilityTarget() {
    const enemies = me.getEnemies();
    const eligible = enemies.filter(enemy => this.isShockwaveEligibleTarget(enemy));
    if (eligible.length === 0) return null;
    const majorCooldownTarget = eligible.find(enemy => pvpHelpers.hasMajorDamageCooldown(enemy, 3));
    if (majorCooldownTarget) return majorCooldownTarget;
    return eligible.length >= 2 ? eligible[0] : null;
  }

  findIntimidatingShoutTarget() {
    const enemies = me.getEnemies();
    const eligibleEnemies = enemies.filter(
      enemy =>
        enemy.isPlayer() &&
        me.distanceTo(enemy) <= 8 &&
        drTracker.getDRStacks(enemy.guid, "disorient") < 2 &&
        !pvpHelpers.hasImmunity(enemy) &&
        !enemy.isCCd()
    );
    if (eligibleEnemies.length < 2) {
      return null;
    }
    const priorityTarget = eligibleEnemies.find(enemy => pvpHelpers.hasMajorDamageCooldown(enemy, 3) || pvpHelpers.hasDisarmableBuff(enemy, false, 3));
    return priorityTarget || eligibleEnemies[0];
  }

  findHealerForStunCC() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (
        enemy.isPlayer() &&
        enemy.isHealer() &&
        me.distanceTo(enemy) <= 30 &&
        drTracker.getDRStacks(enemy.guid, "stun") < 2 &&
        !pvpHelpers.hasImmunity(enemy)
      ) {
        return enemy;
      }
    }
    return null;
  }

  shouldStormBoltCurrentTarget() {
    const target = this.getCurrentTargetPVP();
    if (!target || !target.isPlayer()) return false;
    const healer = this.findHealerForStunCC();
    const healerHasStunDR = healer && drTracker.getDRStacks(healer.guid, "stun") >= 2;
    const targetIsNotHealer = !target.isHealer();
    return healerHasStunDR && targetIsNotHealer && drTracker.getDRStacks(target.guid, "stun") < 2;
  }

  findShatteringThrowTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isPlayer() && me.distanceTo(enemy) <= 30) {
        const hasIceBlock = enemy.hasAura(45438);
        const hasDivineShield = enemy.hasAura(642);
        if (hasIceBlock || hasDivineShield) {
          return enemy;
        }
      }
    }
    return null;
  }

  findFriendlyHealer() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && friend.isHealer() && me.distanceTo(friend) <= 40) {
        return friend;
      }
    }
    return null;
  }

  findHealerUnderRogueCC() {
    if (!Settings.UseProtectiveIntervene) return null;
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && friend.isHealer() && me.distanceTo(friend) <= 25) {
        if (friend.hasAura(1833) || friend.hasAura(408) || friend.hasAura(703)) {
          return friend;
        }
      }
    }
    return null;
  }

  findHealerUnderHunterStun() {
    if (!Settings.UseProtectiveIntervene) return null;
    const friends = me.getFriends();
    for (const friend of friends) {
      if (friend.isPlayer() && friend.isHealer() && me.distanceTo(friend) <= 25 && friend.hasAura("Intimidation")) {
        return friend;
      }
    }
    return null;
  }

  shouldUseDieByTheSword() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (!enemy.isPlayer() || me.distanceTo(enemy) > 20) continue;
      const major = pvpHelpers.hasMajorDamageCooldown(enemy, 3);
      if (!major) continue;
      const isStunned = drTracker.isCCdByCategory(enemy.guid, "stun");
      const isDisoriented = drTracker.isCCdByCategory(enemy.guid, "disorient");
      const isIncap = enemy.hasAura("Polymorph") || enemy.hasAura("Cyclone");
      if (!isStunned && !isDisoriented && !isIncap) {
        return true;
      }
    }
    return false;
  }

  shouldUseImpendingVictory() {
    const friendlyHealer = this.findFriendlyHealer();
    if (!friendlyHealer) {
      return me.effectiveHealthPercent < Settings.ImpendingVictoryNoHealerHealthPct;
    }
    const healerNotInLOS = !me.withinLineOfSight(friendlyHealer);
    const healerCCd =
      drTracker.isCCdByCategory(friendlyHealer.guid, "stun") ||
      drTracker.isCCdByCategory(friendlyHealer.guid, "disorient") ||
      friendlyHealer.hasAura("Polymorph") ||
      friendlyHealer.hasAura("Cyclone") ||
      friendlyHealer.hasAura("Fear") ||
      friendlyHealer.hasAura("Intimidating Shout");
    if (healerNotInLOS || healerCCd) {
      return me.effectiveHealthPercent < Settings.ImpendingVictoryNoHealerHealthPct;
    }
    return me.effectiveHealthPercent < Settings.ImpendingVictoryHealthPct;
  }

  shouldCastPiercingHowl() {
    const enemies = me.getEnemies();
    const enemiesInRange = enemies.filter(
      enemy => enemy.isPlayer() && me.distanceTo(enemy) <= 12 && !pvpHelpers.hasImmunity(enemy) && !enemy.hasAura(1044)
    );
    return enemiesInRange.length >= 2;
  }
}
