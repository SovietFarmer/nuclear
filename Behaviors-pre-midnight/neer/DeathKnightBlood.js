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
import Settings from "@/Core/Settings";
import { Classification } from "@/Enums/UnitEnums";

const auras = {
  coagulatingBlood: 463730,
  boneShield: 195181,
}

export class DeathknightBloodBehavior extends Behavior {
  name = "Death Knight [Blood]";
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Blood;
  static settings = [
    {
      header: "General",
      options: [
      ]
    },
    {
      header: "Defensive",
      options: [
        { type: "slider", uid: "BloodDKDeathStrikeHealth", text: "Death Strike Health (%)", default: 60, min: 0, max: 100 },
      ]
    },
    {
      header: "Utility",
      options: [
        { type: "checkbox", uid: "BloodDKAutoTaunt", text: "Auto Taunt", default: true }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
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
      spell.interrupt("Mind Freeze"),
    );
  }

  tauntRotation() {
    return new bt.Selector(
      spell.cast("Dark Command", on => this.findTauntTarget(), req => Settings.BloodDKAutoTaunt));
  }

  defensiveRotation() {
    return new bt.Selector(
      // Add defensive abilities here
    );
  }

  mainTankingRotation() {
    return new bt.Selector(
      spell.cast("Death Strike", on => me.target || combat.bestTarget, req => this.shouldDeathStrike()),
      spell.cast("Marrowrend", on => me.target || combat.bestTarget, req => !me.hasAura(auras.boneShield) || (me.getAura(auras.boneShield)?.stacks || 0) < 5),
    );
  }

  damageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),
      spell.cast("Blood Boil", on => me, req => spell.getCharges("Blood Boil") === 2 && me.isWithinMeleeRange(combat.bestTarget)),
      spell.cast("Heart Strike", on => me.target || combat.bestTarget),
    );
  }

  // Target finding methods
  findTauntTarget() {
    return combat.targets.find(unit => unit.target && !unit.isTanking());
  }

  // Utility methods
  isInDanger() {
    return combat.targets.find(unit => unit.isTanking());
  }

  shouldDeathStrike() {
    const coagAura = me.getAura(auras.coagulatingBlood);
    return me.pctHealth < Settings.BloodDKDeathStrikeHealth && coagAura && coagAura.stacks > 15 || me.pctPower > 90;
  }
}