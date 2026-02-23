import {Behavior, BehaviorContext} from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import {me} from "@/Core/ObjectManager";
import { defaultHealTargeting as heal, defaultHealTargeting as h } from "@/Targeting/HealTargeting";
import {DispelPriority} from "@/Data/Dispels"
import {WoWDispelType} from "@/Enums/Auras";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { PowerType } from "@/Enums/PowerType";

const auras = {
  infusionOfLight: 54149,
  forbearance: 25771,
  avengingwrath: 31884,
};

export class PaladinHolyPvP extends Behavior {
  name = "Paladin (Holy) PVP";
  context = BehaviorContext.Any;
  specialization = Specialization.Paladin.Holy;

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotWaitingForArenaToStart(),
        common.waitForNotSitting(),
        common.waitForNotMounted(),
        common.waitForCastOrChannel(),
        spell.cast("Divine Protection", on => me, ret => me.pctHealth < 40),
        this.healRotation(),
        common.waitForTarget(),
        common.waitForFacing(),
        this.damageRotation(),
        spell.dispel("Cleanse", true, DispelPriority.Low, true, WoWDispelType.Magic, WoWDispelType.Poison, WoWDispelType.Disease),
      )
    );
  }


  // Healing Rotation
  healRotation() {
    return new bt.Selector(
      // // Maintain Beacon of Light on main target
      // spell.cast("Beacon of Light", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 100),
      // // If talented, maintain Beacon of Faith on second target
      // spell.cast("Beacon of Faith", on => h.getPriorityPVPHealTarget(), ret => spell.isSpellKnown("Beacon of Faith") && this.findSecondaryHealTarget() !== undefined),
      spell.interrupt("Rebuke", true),
      // lay on hands last resort
      spell.cast("Lay on Hands", on => h.getPriorityPVPHealTarget(), ret => this.doesNotHaveForbearance(h.getPriorityPVPHealTarget()) && h.getPriorityPVPHealTarget().pctHealth < 20),
      // Use Word of Glory when reaching 5 Holy Power
      spell.cast("Word of Glory", on => h.getPriorityPVPHealTarget(), ret => me.powerByType(PowerType.HolyPower) > 4 && h.getPriorityPVPHealTarget()?.pctHealth < 90),
      // Use sacrifice
      spell.cast("Blessing of Sacrifice", on => h.getPriorityPVPHealTarget(), ret => me.pctHealth > 80 && this.doesNotHaveForbearance(h.getPriorityPVPHealTarget()) && !(h.getPriorityPVPHealTarget().guid.equals(me.guid)) && h.getPriorityPVPHealTarget().pctHealth < 39),
      // Cast Divine Toll for Holy Power burst generation
      spell.cast("Divine Toll", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 45),
      // Cast Barrier of Faith (if talented) for shields and Divine Favor
      spell.cast("Barrier of Faith", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 50 && spell.isSpellKnown("Barrier of Faith")),
      // Use Word of Glory when reaching 3 Holy Power
      spell.cast("Word of Glory", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 75 &&  me.powerByType(PowerType.HolyPower) > 2),
      // Use Flash of Light for fast emergency healing
      spell.cast("Flash of Light", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 60),
      // Use Infusion of Light procs on Holy Light for bigger heals
      spell.cast("Holy Light", on => h.getPriorityPVPHealTarget(), ret => me.hasAura(auras.infusionOfLight) && h.getPriorityPVPHealTarget()?.pctHealth < 75 && me.getPlayerEnemies(20).length === 0),
      // Dispel harmful debuffs (Purify)
      spell.dispel("Cleanse", true, DispelPriority.High, true, WoWDispelType.Magic, WoWDispelType.Poison, WoWDispelType.Disease),
      spell.cast("Blessing of Freedom", on => heal.friends.All.find(unit => unit.isRooted())),
      // Use Holy Shock to generate Holy Power and for quick heals
      spell.cast("Holy Shock", on => h.getPriorityPVPHealTarget(), ret => h.getPriorityPVPHealTarget()?.pctHealth < 95),

  );
  }

  doesNotHaveForbearance(target) {
    if (!target) {
      return false;
    }
    if (target.hasAura(auras.forbearance)) {
      return false;
    }
    return true;
  }

  // Damage Rotation
  damageRotation() {
    return new bt.Selector(
      spell.cast("Hammer of Wrath",
        on => combat.targets.find(unit => (unit.isPlayer() &&
          (unit.pctHealth < 20  || me.hasAura(auras.avengingwrath))) &&
          me.isFacing(unit)
        ),
        { skipUsableCheck: true }
      ),
      spell.cast("Judgment", on => me.targetUnit),
      // Crusader Strike for Holy Power generation
      spell.cast("Crusader Strike", on => me.targetUnit),
    );
  }

}

