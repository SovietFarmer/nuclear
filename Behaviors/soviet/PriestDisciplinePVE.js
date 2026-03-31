import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultHealTargeting as h } from "@/Targeting/HealTargeting";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import Settings from "@/Core/Settings";

const auras = {
  improvedPurify: 390632, // talent — Purify removes Disease in addition to Magic
  painSuppression: 33206,
  powerWordFortitude: 21562,
  powerOfTheDarkSide: 198068,
  shadowWordPain: 589,
  powerWordShield: 17,
  atonement: 194384,
  surgeOfLight: 114255,
  voidShield: 1253593,
  shadowMend: 1252217,
};

export class PriestDiscipline extends Behavior {
  name = "Priest (Discipline) PVE";
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Discipline;

  healTarget = null;

  static settings = [
    {
      header: "Discipline Priest (Midnight)",
      options: [
        { type: "slider", uid: "DiscPainSuppressionHealth", text: "Pain Suppression threshold (%)", min: 20, max: 60, default: 35 },
        { type: "slider", uid: "DiscRaptureHealth", text: "Rapture threshold (%)", min: 20, max: 60, default: 40 },
        { type: "slider", uid: "DiscVoidShiftHealth", text: "Void Shift threshold (%)", min: 10, max: 40, default: 24 },
        { type: "slider", uid: "DiscEvangelismHealth", text: "Evangelism health trigger (%)", min: 40, max: 90, default: 75 },
        { type: "slider", uid: "DiscEvangelismAtonements", text: "Min atonements for Evangelism", min: 2, max: 8, default: 3 },
        { type: "slider", uid: "DiscUltimatePenitenceAtonements", text: "Min atonements for Ultimate Penitence", min: 3, max: 10, default: 5 },
        { type: "slider", uid: "DiscRadianceLowAllies", text: "Min injured allies for Radiance", min: 2, max: 5, default: 3 },
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),
      common.waitForCastOrChannel(),
      this.waitForNotJustCastPenitence(),

      // Off-GCD
      spell.cast("Fade", on => me, req => me.inCombat() && (me.isTanking() || me.effectiveHealthPercent < 80)),
      spell.cast("Power Word: Fortitude", on => me, ret =>
        !me.hasAura(auras.powerWordFortitude)),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCombat(),

          // Cache heal target every tick
          new bt.Action(() => {
            this.healTarget = h.getPriorityTarget();
            return bt.Status.Failure;
          }),

          // Everything in one flat selector -- heals and damage weave naturally
          this.rotation()
        )
      )
    );
  }

  rotation() {
    return new bt.Selector(
      // =====================================================
      // EMERGENCY CDS -- when someone is dying
      // =====================================================
      spell.cast("Desperate Prayer", on => me, ret =>
        me.effectiveHealthPercent < 40 && me.inCombat()),

      spell.cast("Pain Suppression", on => this.healTarget, ret =>
        this.shouldUsePainSuppression(this.healTarget)),

      spell.cast("Rapture", on => this.healTarget, ret =>
        me.inCombat() && !this.usedMajorHealCDRecently()
        && this.shouldCastWithHealthAndNotPainSupp(this.healTarget, Settings.DiscRaptureHealth)),

      spell.cast("Void Shift", on => this.healTarget, ret =>
        me.inCombat() && !this.usedMajorHealCDRecently()
        && this.shouldCastWithHealthAndNotPainSupp(this.healTarget, Settings.DiscVoidShiftHealth)
        && me.effectiveHealthPercent > 35),

      // Rapture active -- spam PW:S on everyone
      spell.cast("Power Word: Shield", on => this.findFriendWithoutShield(), ret =>
        me.hasAuraByMe("Rapture") && this.findFriendWithoutShield() !== undefined),

      // Defensive Penance when someone is critically low
      spell.cast("Penance", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 30),

      // =====================================================
      // DISPELS (Low priority in PVE)
      // =====================================================
      spell.dispel("Purify", true, DispelPriority.Low, false, WoWDispelType.Magic),
      new bt.Decorator(
        ret => spell.isSpellKnown(auras.improvedPurify),
        spell.dispel("Purify", true, DispelPriority.Low, false, WoWDispelType.Disease)
      ),
      spell.cast("Mass Dispel", on => this.findMassDispelTarget(), ret =>
        this.findMassDispelTarget() !== undefined),

      // =====================================================
      // ATONEMENT COOLDOWNS -- Evangelism / Radiance
      // =====================================================
      spell.cast("Evangelism", on => me, ret =>
        me.inCombat() && !this.usedMajorHealCDRecently()
        && this.getAtonementCount() >= Settings.DiscEvangelismAtonements
        && this.healTarget?.effectiveHealthPercent < Settings.DiscEvangelismHealth),

      spell.cast("Power Word: Radiance", on => me, ret => this.shouldCastRadiance()),

      // =====================================================
      // CORE DAMAGE PRIORITY -- this IS the healing via Atonement
      // =====================================================

      // Void Shield proc -- MUST use before next Penance or the proc is wasted
      // Master the Darkness: 30% after Penance -> next PW:S becomes Void Shield
      // Splashes to 2 nearby allies + applies Atonement to all 3 targets
      // Cast by override name so it appears as "Void Shield" in logs
      spell.cast("Void Shield", on => this.getVoidShieldTarget(), ret =>
        me.hasAura(auras.voidShield) && this.getVoidShieldTarget() !== undefined),

      // Post-Evangelism: spam Radiance charges (they're instant cast after Evangelism)
      spell.cast("Power Word: Radiance", on => me, ret =>
        spell.getTimeSinceLastCast("Evangelism") < 8000
        && spell.getCharges("Power Word: Radiance") > 0),

      // 1. Maintain SW:P (much stronger in Midnight, Penance spreads it)
      spell.cast("Shadow Word: Pain", on => this.currentOrBestTarget(), ret =>
        this.currentOrBestTarget() && !this.hasShadowWordPain(this.currentOrBestTarget())),

      // 2. SW:D always on cooldown -- Expiation value is very high
      spell.cast("Shadow Word: Death", on => this.currentOrBestTarget(), ret =>
        this.currentOrBestTarget() && me.effectiveHealthPercent > 40),

      // 3. Mind Blast (Voidweaver: creates Entropic Rift)
      spell.cast("Mind Blast", on => this.currentOrBestTarget(), ret =>
        this.currentOrBestTarget() !== undefined),

      // 4. Penance -- BLOCKED when Void Shield proc is active (must consume proc first)
      // Voidweaver: Penance grows the Entropic Rift
      spell.cast("Penance", on => this.currentOrBestTarget(), ret =>
        !me.hasAura(auras.voidShield)
        && me.hasAura(auras.powerOfTheDarkSide) && this.currentOrBestTarget() !== undefined),
      spell.cast("Penance", on => this.hasswpTarget(), ret =>
        !me.hasAura(auras.voidShield) && this.hasswpTarget() !== undefined),
      spell.cast("Penance", on => this.currentOrBestTarget(), ret =>
        !me.hasAura(auras.voidShield)
        && this.currentOrBestTarget() && this.hasShadowWordPain(this.currentOrBestTarget())),

      // =====================================================
      // HEALING WEAVE -- procs, atonement, direct heals mixed in
      // =====================================================

      // Surge of Light proc -- free instant Flash Heal
      spell.cast("Flash Heal", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 85 && me.hasAura(auras.surgeOfLight)),

      // Shadow Mend proc
      spell.cast("Shadow Mend", on => this.healTarget, ret =>
        me.hasAura(auras.shadowMend) && this.healTarget?.effectiveHealthPercent < 90),

      // PW:S on hurt ally -- absorb + atonement apply/refresh
      spell.cast("Power Word: Shield", on => this.healTarget, ret =>
        this.healTarget && !this.hasShield(this.healTarget)
        && !me.hasAuraByMe("Rapture")
        && this.healTarget.effectiveHealthPercent < 85),

      // Defensive Penance on hurt ally (blocked by Void Shield proc)
      spell.cast("Penance", on => this.healTarget, ret =>
        !me.hasAura(auras.voidShield) && this.healTarget?.effectiveHealthPercent < 65),

      // Plea for atonement apply or refresh when expiring
      spell.cast("Plea", on => this.healTarget, ret =>
        this.healTarget && this.healTarget.effectiveHealthPercent < 85
        && !me.hasAuraByMe("Rapture")
        && (!this.hasAtonement(this.healTarget)
          || this.healTarget.getAuraByMe(auras.atonement)?.remaining < 4000)),

      // =====================================================
      // REMAINING DAMAGE -- fillers
      // =====================================================

      // Ultimate Penitence / Power Word: Barrier (choice node -- only one talented)
      spell.cast("Ultimate Penitence", on => this.currentOrBestTarget(), ret =>
        me.inCombat() && this.getAtonementCount() >= Settings.DiscUltimatePenitenceAtonements),
      spell.cast("Power Word: Barrier", on => this.healTarget, ret =>
        me.inCombat() && this.healTarget?.effectiveHealthPercent < 50),

      // Spread SW:P to secondary targets
      spell.cast("Shadow Word: Pain", on => this.findswpTarget(), ret =>
        this.findswpTarget() !== undefined),

      // PW:S on cooldown during downtime for extra atonements
      spell.cast("Power Word: Shield", on => this.findFriendWithoutShield(), ret =>
        this.findFriendWithoutShield() !== undefined),

      // Void Blast filler (Voidweaver) -- override of Smite during Entropic Rift
      spell.cast("Void Blast", on => this.currentOrBestTarget(), ret => this.isVoidweaver()),

      // Smite filler (Oracle / Voidweaver fallback)
      spell.cast("Smite", on => this.currentOrBestTarget(), ret =>
        this.currentOrBestTarget() !== undefined),

      // =====================================================
      // FALLBACK -- direct heals and maintenance
      // =====================================================

      // Hard-cast Flash Heal when nothing else is available
      spell.cast("Flash Heal", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 55),

      // Tank atonement maintenance in M+
      spell.cast("Power Word: Shield", on => this.getTankNeedingAtonement(), req =>
        this.shouldApplyAtonementToTank()),
      spell.cast("Plea", on => this.getTankNeedingAtonement(), req =>
        this.shouldApplyAtonementToTank())
    );
  }

  // --- Helpers ---

  waitForNotJustCastPenitence() {
    return new bt.Action(() => {
      if (spell.getTimeSinceLastCast("Ultimate Penitence") < 400) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    });
  }

  isVoidweaver() {
    return spell.isSpellKnown("Void Blast");
  }

  currentOrBestTarget() {
    const target = me.target;
    if (target !== null && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  usedMajorHealCDRecently() {
    if (this.healTarget && this.healTarget.effectiveHealthPercent <= 15) return false;
    const window = 2500;
    if (spell.getTimeSinceLastCast("Pain Suppression") < window) return true;
    if (spell.getTimeSinceLastCast("Desperate Prayer") < window) return true;
    if (spell.getTimeSinceLastCast("Evangelism") < window) return true;
    if (spell.isSpellKnown("Rapture") && spell.getTimeSinceLastCast("Rapture") < window) return true;
    if (spell.isSpellKnown("Void Shift") && spell.getTimeSinceLastCast("Void Shift") < window) return true;
    return false;
  }

  shouldUsePainSuppression(target) {
    if (!target) return false;
    if (this.usedMajorHealCDRecently()) return false;
    if (!me.inCombat()) return false;
    if (target.hasAuraByMe(auras.painSuppression)) return false;
    if (spell.isOnCooldown("Pain Suppression")) return false;
    return (target.effectiveHealthPercent < Settings.DiscPainSuppressionHealth || target.timeToDeath() < 3);
  }

  shouldCastWithHealthAndNotPainSupp(target, health) {
    if (!target) return false;
    return (target.effectiveHealthPercent < health || target.timeToDeath() < 3)
      && !target.hasAura(auras.painSuppression);
  }

  shouldCastRadiance() {
    if (spell.getCharges("Power Word: Radiance") < 2) return false;
    return this.getLowHealthAlliesCount(85) >= Settings.DiscRadianceLowAllies;
  }

  getLowHealthAlliesCount(healthThreshold) {
    return h.friends.All.filter(friend =>
      friend &&
      friend.effectiveHealthPercent < healthThreshold &&
      this.isNotDeadAndInLineOfSight(friend) &&
      !(friend.getAuraByMe(auras.atonement)?.remaining > 4000)
    ).length;
  }

  // --- Target finders ---

  getTankNeedingAtonement() {
    if (!me.inMythicPlus()) return null;
    const tanks = h.friends.Tanks;
    for (const tank of tanks) {
      if (this.isNotDeadAndInLineOfSight(tank)) {
        const atonement = tank.getAuraByMe(auras.atonement);
        if (!atonement || atonement.remaining < 4000) {
          return tank;
        }
      }
    }
    return null;
  }

  shouldApplyAtonementToTank() {
    return me.inMythicPlus() && this.getTankNeedingAtonement() !== null;
  }

  findFriendWithoutAtonement() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (this.isNotDeadAndInLineOfSight(friend) && !this.hasAtonement(friend)) {
        return friend;
      }
    }
    return undefined;
  }

  getVoidShieldTarget() {
    if (this.healTarget && !this.hasShield(this.healTarget)) {
      return this.healTarget;
    }
    const tanks = h.friends.Tanks;
    for (const tank of tanks) {
      if (this.isNotDeadAndInLineOfSight(tank) && !this.hasShield(tank)) {
        return tank;
      }
    }
    return this.findFriendWithoutShield();
  }

  findFriendWithoutShield() {
    const friends = me.getFriends();
    for (const friend of friends) {
      if (this.isNotDeadAndInLineOfSight(friend) && !this.hasShield(friend)) {
        return friend;
      }
    }
    return undefined;
  }

  findMassDispelTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.hasAura("Ice Block") || enemy.hasAura("Divine Shield")) {
        return enemy;
      }
    }
    return undefined;
  }

  findswpTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if ((!this.hasShadowWordPain(enemy) || enemy.getAuraByMe(auras.shadowWordPain)?.remaining < 4000) && enemy.inCombatWithMe) {
        return enemy;
      }
    }
    return undefined;
  }

  hasswpTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (this.hasShadowWordPain(enemy) && me.inCombatWith(enemy) && enemy.effectiveHealthPercent > 10) {
        return enemy;
      }
    }
    return undefined;
  }

  // --- Aura checks ---

  hasAtonement(target) {
    return target?.hasAura(auras.atonement) || false;
  }

  hasShield(target) {
    return target?.hasAura(auras.powerWordShield) || false;
  }

  hasShadowWordPain(target) {
    return target?.hasAura(auras.shadowWordPain) || false;
  }

  isNotDeadAndInLineOfSight(friend) {
    return friend && !friend.deadOrGhost && me.withinLineOfSight(friend);
  }

  getEnemiesInRange(range) {
    return combat.targets.filter(unit => me.distanceTo(unit) < range).length;
  }

  getAtonementCount() {
    return h.friends.All.filter(friend => this.hasAtonement(friend)).length;
  }

  minAtonementDuration() {
    let minDuration = Infinity;
    for (const friend of h.friends.All) {
      if (this.hasAtonement(friend)) {
        const duration = friend.getAuraByMe(auras.atonement).remaining;
        if (duration < minDuration) {
          minDuration = duration;
        }
      }
    }
    return minDuration === Infinity ? 0 : minDuration;
  }
}
