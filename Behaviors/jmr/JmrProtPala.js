import {Behavior, BehaviorContext} from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import {defaultHealTargeting as h} from "@/Targeting/HealTargeting";
import {defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import {DispelPriority} from "@/Data/Dispels"
import {WoWDispelType} from "@/Enums/Auras";
import {PowerType} from "@/Enums/PowerType";

const auras = {
  avengingWrath: 31884,
  shiningLight: 327510,
  grandCrusader: 385726,
  grandCrusaderBuff: 385724,
  consecration: 188370,
  judgment: 197277,
  bulwarkOfRighteousFuryBuff: 386652,
  bulwarkOfRighteousFuryTalent: 386653,
  shakeTheHeavens: 431533,
  shakeTheHeavensTalent: 431532,
  hammerOfLightReady: 427441,
  sacredWeapon: 432502,
  divineGuidance: 433106,
  refiningFire: 469883,
  devotionAura: 465,
};

export class JMRPROTECTIONPALA extends Behavior {
  name = "JMR Protection Paladin";
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Protection;

  isTemplar() {
    return spell.isSpellKnown("Hammer of Light");
  }

  isLightsmith() {
    return spell.isSpellKnown("Holy Bulwark");
  }

  build() {
    return new bt.Selector(
      spell.interrupt("Rebuke"),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotMounted(),
          common.waitForNotSitting(),
          common.waitForCastOrChannel(),
          spell.cast("Devotion Aura", on => me, req => !me.hasAura(auras.devotionAura)),
          spell.cast("Intercession",
            on => {
              const mouseoverGuid = wow.GameUI.mouseOverGuid;
              if (mouseoverGuid && !mouseoverGuid.isNull) {
                return mouseoverGuid.toUnit();
              }
              return null;
            },
            req => {
              const mouseoverGuid = wow.GameUI.mouseOverGuid;
              return mouseoverGuid && this.mouseoverIsDeadFriend() && me.powerByType(PowerType.HolyPower) >= 3;
            }
          ),
          spell.cast("Avenger's Shield", on => combat.targets
            .filter(unit => unit.isCastingOrChanneling && unit.isInterruptible && me.isFacing(unit))
            .sort((a, b) => b.distanceTo(me) - a.distanceTo(me))[0]),
          spell.dispel("Cleanse Toxins", true, DispelPriority.Low, true, WoWDispelType.Poison, WoWDispelType.Disease),
          spell.cast("Hand of Reckoning", on => combat.targets.find(unit => unit.inCombat && unit.target && !unit.isTanking())),
          common.waitForCombat(),
          common.waitForTarget(),
          new bt.Decorator(
            ret => me.inCombat() && this.currentorbestTarget() !== null && this.currentorbestTarget().distanceTo(me) < 15,
            new bt.Selector(
              this.defensives(),
              this.cooldowns(),
              this.trinkets(),
              this.standard(),
            )
          ),
        )
      )
    );
  }

  cooldowns() {
    return new bt.Selector(
      spell.cast("Avenging Wrath", on => me, req => me.inCombat()),
      spell.cast("Light's Judgment", on => this.currentorbestTarget(), req => me.getEnemies(10).length >= 2),
    );
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Lay on Hands", on => me, req => me.effectiveHealthPercent < 10),
      spell.cast("Divine Shield", on => me, req => me.effectiveHealthPercent < 10),
      spell.cast("Ardent Defender", on => me, req => me.effectiveHealthPercent < 25),
      spell.cast("Guardian of Ancient Kings", on => me, req => me.effectiveHealthPercent < 40),
      spell.cast("Word of Glory", on => me, req => me.effectiveHealthPercent < 50),
    );
  }

  trinkets() {
    return new bt.Selector(
    );
  }

  standard() {
    return new bt.Selector(
      spell.cast("Word of Glory", on => h.getPriorityTarget(), req => me.hasAuraByMe(auras.shiningLight)),
      spell.cast("Hammer of Light", on => this.currentorbestTarget(), req => me.hasAuraByMe(auras.hammerOfLightReady)),
      spell.cast("Sacred Weapon", on => me, req => !me.hasAuraByMe(auras.avengingWrath) && !me.hasAuraByMe(auras.sacredWeapon)),
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => this.isTemplar() && this.getLowestRemainsJudgment() !== null),
      spell.cast("Shield of the Righteous", on => me, req => me.powerByType(PowerType.HolyPower) >= 3 || me.hasAuraByMe("Divine Purpose")),
      spell.cast("Avenger's Shield", on => this.currentorbestTarget()),
      spell.cast("Judgment", on => this.getLowestRemainsJudgment(), req => this.getLowestRemainsJudgment() !== null),
      spell.cast("Divine Toll", on => this.currentorbestTarget(), req => me.powerByType(PowerType.HolyPower) === 0),
      spell.cast("Holy Bulwark", on => me),
      spell.cast("Blessed Hammer", on => me),
      spell.cast("Hammer of the Righteous", on => this.currentorbestTarget()),
      spell.cast("Consecration", on => me, req => !me.hasAuraByMe(auras.consecration)),
    );
  }

  getLowestRemainsJudgment() {
    const enemies = me.getEnemies(30);

    if (enemies.length >= 2 && me.target && me.target.hasAuraByMe(auras.judgment)) {
      for (const enemy of enemies) {
        if (me.inCombatWith(enemy) && !enemy.hasAuraByMe(auras.judgment)) {
          return enemy;
        }
      }
    }

    if (me.target) {
      return me.target;
    }
  }

  currentorbestTarget() {
    const target = me.target;
    if (target !== null) {
      return target;
    }
    return combat.bestTarget;
  }

  mouseoverIsDeadFriend() {
    const mouseoverGuid = wow.GameUI.mouseOverGuid;
    if (mouseoverGuid && !mouseoverGuid.isNull) {
      const mouseover = mouseoverGuid.toUnit();
      if (mouseover) {
        return mouseover.deadOrGhost &&
          mouseover.inMyGroup() &&
          mouseover.guid !== me.guid &&
          me.withinLineOfSight(mouseover);
      }
    }
    return false;
  }

  getCurrentTarget() {
    const targetPredicate = unit =>
      unit && common.validTarget(unit) &&
      unit.distanceTo(me) <= 30 &&
      me.withinLineOfSight(unit) &&
      !unit.isImmune();

    const judgedTarget = combat.targets.find(unit => unit.hasAura("Judgement") && targetPredicate(unit));
    if (judgedTarget) {
      return judgedTarget;
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

  isNotDeadAndInLineOfSight(friend) {
    return friend && !friend.deadOrGhost && me.withinLineOfSight(friend);
  }

  getEnemiesInRange(range) {
    return combat.targets.filter(unit => me.distanceTo(unit) < range).length;
  }

}
