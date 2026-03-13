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
  painSuppression: 33206,
  powerOfTheDarkSide: 198068,
  shadowWordPain: 589,
  powerWordShield: 17,
  atonement: 194384,
  surgeOfLight: 114255,
  voidShield: "Void Shield",
  shadowMend: "Shadow Mend",
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
        { type: "slider", uid: "DiscEmergencyHealth", text: "Emergency heal threshold (%)", min: 20, max: 60, default: 40 },
        { type: "slider", uid: "DiscRaptureHealth", text: "Rapture threshold (%)", min: 20, max: 50, default: 30 },
        { type: "slider", uid: "DiscVoidShiftHealth", text: "Void Shift threshold (%)", min: 10, max: 40, default: 24 },
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

      // Off-GCD: Fade for threat
      spell.cast("Fade", on => me, req => me.inCombat() && (me.isTanking() || me.effectiveHealthPercent < 80)),
      // Buff maintenance (off-GCD OK)
      spell.cast("Power Word: Fortitude", on => me, req => !me.hasVisibleAura(21562)),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCombat(),

          // Heal when priority target needs it and has atonement with time remaining
          new bt.Decorator(
            ret => {
              const pt = h.getPriorityTarget();
              return me.inCombat() && pt && pt.effectiveHealthPercent >= 75
                && this.hasAtonement(pt) && pt.getAuraByMe(auras.atonement).remaining > 4000;
            },
            this.damageRotation()
          ),
          new bt.Decorator(
            ret => {
              const pt = h.getPriorityTarget();
              return me.inCombat() && pt && pt.effectiveHealthPercent >= 95;
            },
            this.damageRotation()
          ),

          this.healRotation(),
          this.applyAtonement(),
          common.waitForTarget(),

          new bt.Decorator(
            ret => me.inCombat(),
            this.damageRotation()
          )
        )
      )
    );
  }

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

  getTanks() {
    return h.friends.Tanks.filter(tank => tank !== null);
  }

  applyAtonement() {
    return new bt.Selector(
      spell.cast("Power Word: Shield",
        on => this.findFriendWithoutAtonement(),
        ret => this.findFriendWithoutAtonement() !== undefined
          && this.findFriendWithoutAtonement().effectiveHealthPercent < 90
          && !this.hasShield(this.findFriendWithoutAtonement())
      ),
      spell.cast("Plea",
        on => this.findFriendWithoutAtonement(),
        ret => this.findFriendWithoutAtonement() !== undefined
      )
    );
  }

  healRotation() {
    return new bt.Selector(
      new bt.Action(() => {
        this.healTarget = h.getPriorityTarget();
        return bt.Status.Failure;
      }),

      // Emergency self-heal
      spell.cast("Desperate Prayer", on => me, ret => me.effectiveHealthPercent < Settings.DiscEmergencyHealth && me.inCombat()),

      // Major defensive CDs
      spell.cast("Rapture", on => this.healTarget, ret =>
        this.shouldCastWithHealthAndNotPainSupp(this.healTarget, Settings.DiscRaptureHealth) && me.inCombat()),
      spell.cast("Void Shift", on => this.healTarget, ret =>
        this.shouldCastWithHealthAndNotPainSupp(this.healTarget, Settings.DiscVoidShiftHealth)),

      // Mass Dispel for immunities
      spell.cast("Mass Dispel", on => this.findMassDispelTarget(), ret => this.findMassDispelTarget() !== undefined),

      // Evangelism ramp when enough atonements and group is hurting
      spell.cast("Evangelism", on => me, ret =>
        me.inCombat() && this.getAtonementCount() >= Settings.DiscEvangelismAtonements
        && this.healTarget?.effectiveHealthPercent < 50),

      // Radiance for group atonement spread
      spell.cast("Power Word: Radiance", on => me, ret => this.shouldCastRadiance()),

      // Defensive Penance on low-health ally
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < Settings.DiscEmergencyHealth),

      // Surge of Light proc -- free instant Flash Heal
      spell.cast("Flash Heal", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 75 && me.hasAura(auras.surgeOfLight)),

      // Shield for atonement when not in Rapture
      spell.cast("Power Word: Shield", on => this.healTarget, ret =>
        this.healTarget?.effectiveHealthPercent < 90 && !this.hasShield(this.healTarget) && !me.hasVisibleAura("Rapture")),

      // Void Shield proc (Oracle) -- use PW:S immediately
      spell.cast("Power Word: Shield", on => this.healTarget, ret =>
        me.hasAura(auras.voidShield) && this.healTarget && !this.hasShield(this.healTarget)),

      // Shadow Mend proc
      spell.cast("Shadow Mend", on => this.healTarget, ret =>
        me.hasAura(auras.shadowMend) && this.healTarget?.effectiveHealthPercent < 85),

      // Plea replaces Renew as single-target atonement applicator
      spell.cast("Plea", on => this.healTarget, ret =>
        (!this.hasAtonement(this.healTarget) || this.healTarget.getAuraByMe(auras.atonement)?.remaining < 4000)
        && this.healTarget?.effectiveHealthPercent < 80 && !me.hasVisibleAura("Rapture")),

      // Dispels
      spell.dispel("Purify", true, DispelPriority.High, false, WoWDispelType.Magic),

      // Damage through atonement: Mind Blast
      spell.cast("Mind Blast", on => this.currentOrBestTarget(), ret => this.hasAtonement(this.healTarget)),

      // Shadowfiend / Voidwraith for mana and damage
      spell.cast("Shadowfiend", on => this.currentOrBestTarget(), ret => me.inCombat() && this.hasAtonement(this.healTarget)),
      spell.cast("Voidwraith", on => this.currentOrBestTarget(), ret => me.inCombat() && this.hasAtonement(this.healTarget)),

      // SW:D always on cooldown for Expiation value
      spell.cast("Shadow Word: Death", on => this.currentOrBestTarget(), ret =>
        me.inCombat() && me.effectiveHealthPercent > 40 && this.hasAtonement(this.healTarget)),

      // Low-priority dispels
      spell.dispel("Purify", true, DispelPriority.Low, false, WoWDispelType.Magic, WoWDispelType.Disease),

      // Context-based Penance (offensive if atonement up, defensive otherwise)
      spell.cast("Penance", on => this.getPenanceTarget(), ret => this.shouldCastPenance()),

      // Hard-cast Flash Heal as emergency fallback
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 55),
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 50),

      this.maintainTankAtonement()
    );
  }

  damageRotation() {
    return new bt.Selector(
      // SW:P maintenance -- much stronger in Midnight, Penance spreads it
      spell.cast("Shadow Word: Pain", on => this.currentOrBestTarget(), ret =>
        !this.hasShadowWordPain(this.currentOrBestTarget())),

      // Power of the Dark Side proc -- empowered Penance
      spell.cast("Penance", on => this.currentOrBestTarget(), ret => me.hasAura(auras.powerOfTheDarkSide)),

      // SW:D always on CD for Expiation (not just execute range)
      spell.cast("Shadow Word: Death", on => this.currentOrBestTarget(), ret => me.effectiveHealthPercent > 40),

      // Mind Blast
      spell.cast("Mind Blast", on => this.currentOrBestTarget(), ret => true),

      // Penance on target with SW:P for dot spread
      spell.cast("Penance", on => this.hasswpTarget(), ret => this.hasswpTarget() !== undefined),
      spell.cast("Penance", on => this.currentOrBestTarget(), ret => this.hasShadowWordPain(this.currentOrBestTarget())),

      // Ultimate Penitence when enough atonements are out
      spell.cast("Ultimate Penitence", on => this.currentOrBestTarget(), ret =>
        me.inCombat() && this.getAtonementCount() >= Settings.DiscUltimatePenitenceAtonements),

      // Shadowfiend / Voidwraith
      spell.cast("Shadowfiend", on => this.currentOrBestTarget(), ret => me.inCombat()),
      spell.cast("Voidwraith", on => this.currentOrBestTarget(), ret => me.inCombat()),

      // Spread SW:P to secondary targets
      spell.cast("Shadow Word: Pain", on => this.findswpTarget(), ret => this.findswpTarget() !== undefined),

      // Voidweaver: Void Blast spam (override of Smite, Shadow school)
      spell.cast("Void Blast", on => this.currentOrBestTarget(), ret => this.isVoidweaver()),
      // Voidweaver: PW:S on cooldown during downtime
      spell.cast("Power Word: Shield", on => this.findFriendWithoutAtonement(), ret =>
        this.isVoidweaver() && this.findFriendWithoutAtonement() !== undefined
        && !this.hasShield(this.findFriendWithoutAtonement())),

      // Oracle: PW:S on Void Shield proc
      spell.cast("Power Word: Shield", on => this.findFriendWithoutAtonement(), ret =>
        !this.isVoidweaver() && me.hasAura(auras.voidShield)
        && this.findFriendWithoutAtonement() !== undefined),
      // Oracle: Shadow Mend proc
      spell.cast("Shadow Mend", on => h.getPriorityTarget(), ret =>
        !this.isVoidweaver() && me.hasAura(auras.shadowMend) && h.getPriorityTarget() !== undefined),

      // Smite filler (fallback for Voidweaver if Void Blast fails, primary filler for Oracle)
      spell.cast("Smite", on => this.currentOrBestTarget(), ret => true)
    );
  }

  maintainTankAtonement() {
    return new bt.Selector(
      spell.cast("Power Word: Shield", on => this.getTankNeedingAtonement(), req => this.shouldApplyAtonementToTank()),
      spell.cast("Plea", on => this.getTankNeedingAtonement(), req => this.shouldApplyAtonementToTank())
    );
  }

  hasTalent(talentName) {
    return spell.isSpellKnown(talentName);
  }

  currentOrBestTarget() {
    const target = me.target;
    if (target !== null && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  getTankNeedingAtonement() {
    if (!me.inMythicPlus()) {
      return null;
    }

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

  shouldCastRadiance() {
    if (spell.getCharges("Power Word: Radiance") < 2) {
      return false;
    }
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

  getCurrentTarget() {
    const targetPredicate = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.inCombatWithMe) {
        return enemy;
      }
    }
  }

  shouldCastPenance() {
    const priorityTarget = this.healTarget;
    const currentTarget = this.getCurrentTarget();

    if (!priorityTarget) {
      return currentTarget != null;
    }

    return priorityTarget.effectiveHealthPercent < 55 ||
      (priorityTarget.effectiveHealthPercent >= 55 &&
        this.hasAtonement(priorityTarget) &&
        currentTarget != null &&
        this.hasShadowWordPain(currentTarget));
  }

  getPenanceTarget() {
    const priorityTarget = this.healTarget;
    const currentTarget = this.getCurrentTarget();

    if (!priorityTarget) {
      return currentTarget;
    }

    if (priorityTarget.effectiveHealthPercent < 55) {
      return priorityTarget;
    } else if (this.hasAtonement(priorityTarget) && currentTarget != null && this.hasShadowWordPain(currentTarget)) {
      return currentTarget;
    }

    return currentTarget;
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

  hasAtonement(target) {
    return target?.hasAura(auras.atonement) || false;
  }

  hasShield(target) {
    return target?.hasAura(auras.powerWordShield) || false;
  }

  hasShadowWordPain(target) {
    return target?.hasAura(auras.shadowWordPain) || false;
  }

  shouldCastWithHealthAndNotPainSupp(target, health) {
    if (!target) {
      return false;
    }
    return (target.effectiveHealthPercent < health || target.timeToDeath() < 3) && !target.hasAura(auras.painSuppression);
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
