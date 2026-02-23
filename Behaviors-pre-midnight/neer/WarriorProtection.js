import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { MovementFlags } from "@/Enums/Flags";
import { DispelPriority } from "@/Data/Dispels";
import { WoWDispelType } from "@/Enums/Auras";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { defaultHealTargeting as heal } from "@/Targeting/HealTargeting";
import Settings from "@/Core/Settings";
import { Classification } from "@/Enums/UnitEnums";

const auras = {
  shieldblock: 132404,
  freeRevenge: 5302,
  ignorePain: 190456
}

export class WarriorProtectionBehavior extends Behavior {
  name = "Warrior [Protection]";
  context = BehaviorContext.Any;
  specialization = Specialization.Warrior.Protection;
  static settings = [
    {
      header: "General",
      options: [
      ]
    },
    {
      header: "Defensive",
      options: [

      ]
    },
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "ProtectionWarriorAutoTaunt", text: "Auto Taunt", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      // General
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      spell.cast("Battle Shout", on => me, req => !me.inCombat() && !me.hasAura("Battle Shout")),
      this.interruptRotation(),
      this.tauntRotation(),
      this.defensiveRotation(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForTarget(),
          this.mainTankingRotation(),
          this.damageRotation()
        )
      )
    );
  }

  interruptRotation() {
    return new bt.Selector(
      spell.interrupt("Pummel"),
      spell.interrupt("Storm Bolt"),
    );
  }

  tauntRotation() {
    return new bt.Selector(
      spell.cast("Taunt", on => this.findTauntTarget(), req => Settings.ProtectionWarriorAutoTaunt)
    );
  }

  defensiveRotation() {
    return new bt.Selector(
      spell.cast("Shield Block", on => me, req => !me.hasAura(auras.shieldblock) && this.isInDanger()),
      spell.cast("Ignore Pain", on => me, req => me.pctPower > 65 || !me.hasAura(auras.ignorePain)),
      spell.cast("Spell Reflection", on => me, req => this.shouldSpellReflect()),
      spell.cast("Challenging Shout", on => me, req => this.shouldChallengingShout())
    );
  }


  mainTankingRotation() {
    return new bt.Selector(
      spell.cast("Victory Rush", on => me.targetUnit, req => me.pctHealth < 90),
      spell.cast("Demoralizing Shout", on => me, req => (me.targetUnit?.classification == Classification.Boss || combat.getUnitsAroundUnit(me, 10).length > 2) && !me.isMoving()),
      spell.cast("Shockwave", on => me, req => combat.targets.filter(unit => me.distanceTo(unit) < 8 && me.isFacing(unit)).length > 2),
      spell.cast("Heroic Throw", on => combat.targets.find(unit => !unit.isTanking() && me.isFacing(unit))),
    );
  }

  damageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),
      spell.cast("Heroic Throw", on => me.targetUnit, req => me.distanceTo(me.targetUnit) > 12),
      spell.cast("Shield Slam", on => me.targetUnit),
      spell.cast("Thunder Clap", on => me, req => me.distanceTo(me.targetUnit) < 8),
      spell.cast("Execute", on => combat.targets.find(unit => unit.pctHealth < 20), req => me.pctPower > 50, { skipUsableCheck: true }),
      spell.cast("Revenge", on => me.targetUnit, req => me.hasAura(auras.freeRevenge)),
    );
  }

  // Target finding methods
  findTauntTarget() {
    return combat.targets.find(unit => unit.inCombat() && unit.target && !unit.isTanking());
  }

  // Utility methods
  isInDanger() {
    return combat.targets.find(unit => unit.isTanking());
  }

  shouldSpellReflect() {
    return combat.targets.find(unit =>
      unit.isCastingOrChanneling &&
      unit.spellInfo?.spellTargetGuid?.equals(me.guid) &&
      unit.spellInfo &&
      (unit.spellInfo.castEnd - wow.frameTime) > 100 &&
      (unit.spellInfo.castEnd - wow.frameTime) < 200
    );
  }

  shouldChallengingShout() {
    return combat.targets.filter(unit =>
      me.distanceTo(unit) <= 12 &&
      !unit.isTanking()
    ).length > 2;
  }
}
