import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const auras = {
  battle_shout: 6673,
  shield_block: 132404,
  avatar: 107574,
  ignore_pain: 190456,
  shield_wall: 871,
  last_stand: 12975,
};

export class WarriorProtMidnight extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Protection;
  name = "Jmr Prot Warrior (Midnight)";
  version = wow.GameVersion.Retail;

  static settings = [
    { header: "Jmr Prot Warrior (Midnight)" },
    { header: "" },
    { header: "Tanking" },
    { type: "checkbox", uid: "JmrProtAutoTaunt", text: "Auto Taunt loose mobs", default: false },
    { header: "" },
    { header: "Defensive Thresholds" },
    { type: "slider", uid: "JmrProtIgnorePainRage", text: "Ignore Pain Min Rage", min: 30, max: 80, default: 50 },
    { type: "slider", uid: "JmrProtShieldWallHP", text: "Shield Wall Health %", min: 10, max: 60, default: 40 },
    { type: "slider", uid: "JmrProtLastStandHP", text: "Last Stand Health %", min: 10, max: 60, default: 50 },
    { type: "slider", uid: "JmrProtRallyingCryHP", text: "Rallying Cry Health %", min: 10, max: 50, default: 30 },
    { type: "slider", uid: "JmrProtImpendingVictoryHP", text: "Impending Victory Health %", min: 30, max: 80, default: 60 },
    { header: "" },
    { header: "Offensive Cooldowns" },
    { type: "checkbox", uid: "JmrProtUseAvatar", text: "Use Avatar", default: true },
    { type: "checkbox", uid: "JmrProtUseDemoShout", text: "Use Demoralizing Shout", default: true },
    { type: "checkbox", uid: "JmrProtUseShieldCharge", text: "Use Shield Charge", default: true },
    { type: "checkbox", uid: "JmrProtUseRavager", text: "Use Ravager", default: true },
    { header: "" },
    { header: "Utility" },
    { type: "checkbox", uid: "JmrProtUseCharge", text: "Auto Charge into combat", default: false },
    { type: "checkbox", uid: "JmrProtUseSpellReflect", text: "Use Spell Reflection", default: true },
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForNotSitting(),

      // Off-GCD abilities before the GCD gate
      spell.interrupt("Pummel"),
      spell.interrupt("Storm Bolt"),
      spell.cast("Spell Reflection", on => me, req => Settings.JmrProtUseSpellReflect && this.shouldSpellReflect()),

      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForCastOrChannel(),
          common.waitForFacing(),
          common.waitForTarget(),

          spell.cast("Battle Shout", on => me, req => !me.hasAura(auras.battle_shout)),

          spell.cast("Charge",
            on => me.target,
            req => Settings.JmrProtUseCharge && me.target && me.distanceTo(me.target) >= 8 && me.distanceTo(me.target) <= 25
          ),

          spell.cast("Taunt",
            on => combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()),
            req => Settings.JmrProtAutoTaunt &&
                   combat.targets.find(unit => unit.inCombat() && unit.distanceTo(me) <= 30 && !unit.isTanking()) !== undefined
          ),

          common.waitForCombat(),

          this.useDefensives(),

          new bt.Decorator(
            () => this.getEnemiesInRange(12) >= 1,
            new bt.Selector(
              this.offensiveCooldowns(),
              this.coreRotation(),
            )
          ),
        )
      )
    );
  }

  useDefensives() {
    return new bt.Selector(
      spell.cast("Shield Block", on => me, req => {
        const sb = me.getAura(auras.shield_block);
        return (!sb || sb.remaining < 2000) && me.powerByType(PowerType.Rage) >= 30;
      }),
      spell.cast("Shield Wall", on => me, req =>
        me.pctHealth < Settings.JmrProtShieldWallHP && !me.hasAuraByMe(auras.last_stand)
      ),
      spell.cast("Last Stand", on => me, req =>
        me.pctHealth < Settings.JmrProtLastStandHP && !me.hasAuraByMe(auras.shield_wall)
      ),
      spell.cast("Rallying Cry", on => me, req => me.pctHealth < Settings.JmrProtRallyingCryHP),
    );
  }

  offensiveCooldowns() {
    return new bt.Selector(
      this.useRacials(),
      spell.cast("Avatar", on => me, req => Settings.JmrProtUseAvatar),
      spell.cast("Ravager", on => this.getCurrentTarget(), req => Settings.JmrProtUseRavager),
      spell.cast("Demoralizing Shout", on => me, req => Settings.JmrProtUseDemoShout),
      spell.cast("Shield Charge", on => this.getCurrentTarget(), req => Settings.JmrProtUseShieldCharge),
      common.useTrinkets(() => this.getCurrentTarget()),
    );
  }

  coreRotation() {
    return new bt.Selector(
      // Shield Slam — highest priority, reset by Strategist / Devastator
      spell.cast("Shield Slam", on => this.getCurrentTarget()),
      // Thunder Clap — applies/refreshes Rend; Thunder Blast is the Mountain Thane override
      spell.cast("Thunder Blast", on => this.getCurrentTarget()),
      spell.cast("Thunder Clap", on => this.getCurrentTarget()),
      // Revenge — free procs or rage spender for damage
      spell.cast("Revenge", on => this.getCurrentTarget()),
      // Ignore Pain — dump excess rage into absorb shield
      spell.cast("Ignore Pain", on => me, req => me.powerByType(PowerType.Rage) >= Settings.JmrProtIgnorePainRage),
      // Execute — low HP targets (20%, or 35% with Massacre)
      spell.cast("Execute", on => this.getCurrentTarget(), req => this.isExecutePhase()),
      // Impending Victory / Victory Rush — self heal when low
      spell.cast("Impending Victory", on => this.getCurrentTarget(), req => me.pctHealth < Settings.JmrProtImpendingVictoryHP),
      spell.cast("Victory Rush", on => this.getCurrentTarget(), req => me.pctHealth < Settings.JmrProtImpendingVictoryHP),
      // Devastate — filler when Devastator talent is not active
      spell.cast("Devastate", on => this.getCurrentTarget()),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury"),
      spell.cast("Berserking"),
      spell.cast("Fireblood"),
      spell.cast("Ancestral Call"),
      spell.cast("Light's Judgment", on => this.getCurrentTarget()),
      spell.cast("Bag of Tricks", on => this.getCurrentTarget()),
      spell.cast("Arcane Torrent"),
    );
  }

  isExecutePhase() {
    const target = this.getCurrentTarget();
    if (!target) return false;
    return (me.hasAura("Massacre") && target.pctHealth <= 35) || target.pctHealth <= 20;
  }

  getCurrentTarget() {
    const targetPredicate = unit => common.validTarget(unit) && me.isWithinMeleeRange(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  shouldSpellReflect() {
    if (me.hasAuraByMe("Spell Reflection")) return false;
    for (const enemy of combat.targets) {
      if (!enemy.isCastingOrChanneling || !enemy.spellInfo) continue;
      const target = enemy.spellInfo.spellTargetGuid;
      if (target && target.equals(me.guid)) {
        const castRemains = enemy.spellInfo.castEnd - wow.frameTime;
        if (castRemains > 0 && castRemains < 1000) return true;
      }
    }
    return false;
  }
}
