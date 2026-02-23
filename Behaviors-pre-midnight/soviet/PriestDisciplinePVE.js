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
import spellBlacklist from "@/Data/PVPData";

const auras = {
  painSuppression: 33206,
  powerOfTheDarkSide: 198068,
  shadowWordPain: 589,
  powerWordShield: 17,
  atonement: 194384,
  surgeOfLight: 114255,
  premonitionPiety: 428930,
  premonitionSolace: 428934,
  premonitionInsight: 428933,
  harshDiscipline: 373183,
  twilightEquilibriumHolyAmp: 390706,
  twilightEquilibriumShadowAmp: 390707,
  wealAndWoe: 390787,
};

export class PriestDiscipline extends Behavior {
  name = "Priest (Discipline) PVE";
  context = BehaviorContext.Any;
  specialization = Specialization.Priest.Discipline;

  // Define healTarget as a class property
  healTarget = null;

  build() {
    console.info(`Welcome to: ${this.name} rotation. Pain suppression / Power word Barrier are to be used by you.`);
    return new bt.Selector(
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotMounted(),
          common.waitForNotSitting(),
          common.waitForCastOrChannel(),
          this.waitForNotJustCastPenitence(),
          spell.cast("Renew", on => me, req => me.hasVisibleAuraByMe(90985) && me.getAuraByMe(90985).remaining < 3000),
          spell.cast("Fade", on => me, req => me.inCombat() &&   me.effectiveHealthPercent > 60 && (me.isTanking() || me.effectiveHealthPercent < 90)),
          spell.cast("Power Word: Fortitude", on => me, req => !me.hasVisibleAura(21562)),
          new bt.Decorator(
            ret => me.inCombat() && h.getPriorityTarget() !== undefined && h.getPriorityTarget().effectiveHealthPercent >= 75 && h.getPriorityTarget().hasVisibleAuraByMe(auras.atonement) && h.getPriorityTarget().getAuraByMe(auras.atonement).remaining > 4000,
            this.damageRotation(),
            new bt.Action(() => bt.Status.Success)
          ),
          new bt.Decorator(
            ret => me.inCombat() && h.getPriorityTarget() !== undefined && h.getPriorityTarget().effectiveHealthPercent >= 95,
            this.damageRotation(),
            new bt.Action(() => bt.Status.Success)
          ),
          this.healRotation(),
          this.applyAtonement(),
          common.waitForTarget(),
          new bt.Decorator(
            ret => me.inCombat(),
            new bt.Selector(
              this.damageRotation()
            )
          )
        )
      )
    );
  }

  waitForNotJustCastPenitence() {
    return new bt.Action(() => {
      let lastCastPenitence = spell.getTimeSinceLastCast("Ultimate Penitence");
      if (lastCastPenitence < 400) {
        return bt.Status.Success;
      }
      return bt.Status.Failure;
    });
  }

  getTanks() {
    return h.friends.Tanks.filter(tank => tank !== null);
  }

  applyAtonement() {
    return new bt.Selector(
      spell.cast("Power Word: Shield", on => this.findFriendWithoutAtonement(), ret => this.findFriendWithoutAtonement() !== undefined && this.findFriendWithoutAtonement().effectiveHealthPercent < 90 && !this.hasShield(this.findFriendWithoutAtonement()))
    );
  }

  healRotation() {
    return new bt.Selector(
      new bt.Action(() => {
        this.healTarget = h.getPriorityTarget();
        return bt.Status.Failure; // Proceed to next child
      }),
      spell.cast("Power Word: Life", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 50 && me.inCombat()),
      spell.cast("Desperate Prayer", on => me, ret => me.effectiveHealthPercent < 40 && me.inCombat()),
      //spell.cast("Pain Suppression", on => this.healTarget, ret => this.shouldCastWithHealthAndNotPainSupp(this.healTarget, 34) && me.inCombat()),
      spell.cast("Rapture", on => this.healTarget, ret => this.shouldCastWithHealthAndNotPainSupp(this.healTarget, 30) && me.inCombat()),
      spell.cast("Void Shift", on => this.healTarget, ret => this.shouldCastWithHealthAndNotPainSupp(this.healTarget, 24)),
      spell.cast("Mass Dispel", on => this.findMassDispelTarget(), ret => this.findMassDispelTarget() !== undefined),
      spell.cast("Premonition", on => me, ret => this.shouldCastPremonition(this.healTarget)),
      spell.cast("Shadow Word: Death", on => this.findDeathThePolyTarget(), ret => this.findDeathThePolyTarget() !== undefined),
      spell.cast("Evangelism", on => me, ret => me.inCombat() && this.getAtonementCount() > 3 && this.healTarget?.effectiveHealthPercent < 35),
      //spell.cast("Power Word: Barrier", on => this.healTarget, ret => this.shouldCastWithHealthAndNotPainSupp(this.healTarget, 40) && me.inCombat()),
      spell.cast("Power Word: Shield", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 90 && !this.hasShield(this.healTarget) && !me.hasVisibleAura("Rapture")),
      spell.cast("Power Word: Radiance", on => me, ret => this.shouldCastRadiance()),
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 40),
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 75 && me.hasAura(auras.surgeOfLight)),
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 75 && me.effectiveHealthPercent < 90 && !me.hasVisibleAura("Protective Light")),
      spell.dispel("Purify", true, DispelPriority.High, false, WoWDispelType.Magic),
      //spell.dispel("Dispel Magic", false, DispelPriority.High, true, WoWDispelType.Magic),
      spell.cast("Renew", on => this.healTarget, ret => (!this.hasAtonement(this.healTarget) || this.healTarget.getAuraByMe(auras.atonement).remaining < 4000) && this.healTarget?.effectiveHealthPercent < 80 && !me.hasVisibleAura("Rapture")),
      spell.cast("Mind Blast", on => this.currentOrBestTarget(), ret => this.hasAtonement(this.healTarget)),
      spell.cast("Shadowfiend", on => this.currentOrBestTarget(), ret => me.inCombat() && this.hasAtonement(this.healTarget)),
      spell.cast("Voidwraith", on => this.currentOrBestTarget(), ret => me.inCombat() && this.hasAtonement(this.healTarget)),
      spell.dispel("Purify", true, DispelPriority.Low, false, WoWDispelType.Magic, WoWDispelType.Disease),
      spell.cast("Shadow Word: Death", on => this.findShadowWordDeathTarget(), ret => me.effectiveHealthPercent > 60 && this.findShadowWordDeathTarget() !== undefined && this.hasAtonement(this.healTarget)),
      spell.cast("Penance", on => this.getPenanceTarget(), ret => this.shouldCastPenance()),
      spell.cast("Flash Heal", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 55),
      spell.cast("Penance", on => this.healTarget, ret => this.healTarget?.effectiveHealthPercent < 50),
      this.maintainTankAtonement()
    );
  }

  damageRotation() {
    return new bt.Selector(
      // Buff Management: Prioritize spells based on active buffs
      spell.cast("Penance", on => this.currentOrBestTarget(), ret => me.hasAura(auras.harshDiscipline)),
      spell.cast("Penance", on => this.currentOrBestTarget(), ret => me.hasAura(auras.powerOfTheDarkSide)),
      spell.cast("Mind Blast", on => this.currentOrBestTarget(), ret => true),
      spell.cast("Smite", on => this.currentOrBestTarget(), ret => me.hasAura(auras.twilightEquilibriumHolyAmp)),
      spell.cast("Smite", on => this.currentOrBestTarget(), ret => me.hasAura(auras.wealAndWoe)),

      // Schism: Cast on cooldown if the target doesn't have the debuff
      spell.cast("Schism", on => this.currentOrBestTarget(), ret => !this.currentOrBestTarget().hasAura("Schism") && me.inCombat()),

      // Ultimate Penitence
      spell.cast("Ultimate Penitence", on => this.currentOrBestTarget(), ret => me.inCombat() && this.getAtonementCount() > 5),

      // Core Rotation Spells
      spell.cast("Shadow Word: Pain", on => this.currentOrBestTarget(), ret => !this.hasShadowWordPain(this.currentOrBestTarget())),
      spell.cast("Power Word: Radiance", on => me, ret => ((this.hasTalent("Voidwraith") && spell?.getCooldown("Voidwraith")?.timeleft < 1.5) || spell?.getCooldown("Shadowfiend").timeleft < 1.5 || me.hasVisibleAura("Shadow Covenant")) && spell.getCharges("Power Word: Radiance") === 2),
      spell.cast("Shadowfiend", on => this.currentOrBestTarget(), ret => me.inCombat()),
      spell.cast("Voidwraith", on => this.currentOrBestTarget(), ret => me.inCombat()),
      spell.cast("Shadow Word: Death", on => this.findShadowWordDeathTarget(), ret => me.effectiveHealthPercent > 60 && this.findShadowWordDeathTarget() !== undefined),
      spell.cast("Shadow Word: Death", on => this.currentOrBestTarget(), ret => me.effectiveHealthPercent > 60 && me.hasVisibleAura("Shadow Covenant")),
      spell.cast("Mindgames", on => me.targetUnit, ret => me.targetUnit?.effectiveHealthPercent < 50),
      spell.cast("Penance", on => this.hasswpTarget(), ret => this.hasswpTarget() !== undefined),
      spell.cast("Penance", on => this.currentOrBestTarget(), ret => this.hasShadowWordPain(this.currentOrBestTarget())),
      spell.cast("Halo", on => me, ret => this.getEnemiesInRange(40) >= 3),
      spell.cast("Smite", on => this.currentOrBestTarget(), ret => me.hasVisibleAura("Shadow Covenant")),
      spell.cast("Shadow Word: Pain", on => this.findswpTarget(), ret => this.findswpTarget() !== undefined),
      spell.cast("Smite", on => this.currentOrBestTarget(), ret => true)
    );
  }

  maintainTankAtonement() {
    return new bt.Selector(
      spell.cast("Power Word: Shield", on => this.getTankNeedingAtonement(), req => this.shouldApplyAtonementToTank()),
      spell.cast("Renew", on => this.getTankNeedingAtonement(), req => this.shouldApplyAtonementToTank())
    );
  }

  hasTalent(talentName) {
    return spell.isSpellKnown(talentName);
  }

  currentOrBestTarget() {
    const schismTarget = combat.targets.find(unit => unit.hasVisibleAuraByMe("Schism"));
    const target = me.target;
    if (schismTarget) {
      return schismTarget;
    }
    if (target !== null && me.canAttack(target)) {
      return target;
    }
    if (target === null) {
      return combat.bestTarget;
    }
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

    const lowHealthAllies = this.getLowHealthAlliesCount(85);
    if (lowHealthAllies < 3) {
      return false;
    }
    return true;
  }

  getLowHealthAlliesCount(healthThreshold) {
    return h.friends.All.filter(friend =>
      friend &&
      friend.effectiveHealthPercent < healthThreshold &&
      this.isNotDeadAndInLineOfSight(friend) &&
      !friend.getAuraByMe(auras.atonement)?.remaining > 4000
    ).length;
  }

  getCurrentTarget() {
    const targetPredicate = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    const schismTarget = combat.targets.find(unit => unit.hasAura("Schism") && targetPredicate(unit));
    if (schismTarget) {
      return schismTarget;
    }

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
    const priorityTarget = this.healTarget; // Use cached healTarget
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
    const priorityTarget = this.healTarget; // Use cached healTarget
    const currentTarget = this.getCurrentTarget();

    if (!priorityTarget) {
      return currentTarget;
    }

    if (priorityTarget.effectiveHealthPercent < 55) {
      return priorityTarget;
    } else if (priorityTarget.effectiveHealthPercent >= 55 &&
      this.hasAtonement(priorityTarget) &&
      currentTarget != null &&
      this.hasShadowWordPain(currentTarget)) {
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

  findShadowWordDeathTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.effectiveHealthPercent < 20 && enemy.inCombatWithMe) {
        return enemy;
      }
    }
    return undefined;
  }

  findswpTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if ((!this.hasShadowWordPain(enemy) || enemy.getAuraByMe(auras.shadowWordPain).remaining < 4000) && enemy.inCombatWithMe) {
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

  findDeathThePolyTarget() {
    const enemies = me.getEnemies();
    for (const enemy of enemies) {
      if (enemy.isCastingOrChanneling && enemy.isPlayer()) {
        const spellInfo = enemy.spellInfo;
        const target = spellInfo ? spellInfo.spellTargetGuid : null;
        if (enemy.spellInfo) {
          const onBlacklist = spellBlacklist[enemy.spellInfo.spellCastId];
          const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
          if (target && target.equals(me.guid) && onBlacklist && castRemains < 1000) {
            return enemy;
          }
        }
      }
    }
    return undefined;
  }

  shouldCastPremonition(target) {
    if (!target) {
      return false;
    }
    if (me.hasAura(auras.premonitionInsight) || me.hasAura(auras.premonitionSolace) || me.hasAura(auras.premonitionPiety)) {
      return false;
    }
    return target.effectiveHealthPercent < 50 || target.timeToDeath() < 3;
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
