import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import { PowerType } from "@/Enums/PowerType";

const auras = {
  subterfuge: 115192,
  audacity: 386270,
  opportunity: 195627,
  sliceAndDice: 315496,
  bladeFlurry: 13877,
  feint: 1966
}

export class RogueOutlawBehavior extends Behavior {
  name = "Rogue [Outlaw]";
  context = BehaviorContext.Any;
  specialization = Specialization.Rogue.Combat;
  static settings = [
    {
    }
  ];

  build() {
    return new bt.Selector(
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      this.interrupt(),
      this.defensives(),
      this.cooldowns(),
      common.ensureAutoAttack(),
      this.finishers(),
      this.builders()
    );
  }

  interrupt() {
    return new bt.Selector(
      spell.interrupt("Kick"),
      spell.interrupt("Gouge")
    );
  }

  defensives() {
    return new bt.Selector(
      spell.cast("Crimson Vial", on => me, req => me.pctHealth < 70),
      spell.cast("Feint", on => me, req => me.pctHealth < 50 && !me.hasAura(auras.feint))
    );
  }

  cooldowns() {
    return new bt.Selector(
      spell.cast("Blade Flurry", req => this.isAoe() && !me.hasAura(auras.bladeFlurry)),
      spell.cast("Roll the Bones", req => this.shouldRollTheBones()),
      spell.cast("Adrenaline Rush"),
      spell.cast("Killing Spree", req => this.getComboPoints() >= 6 && !me.hasAura("Stealth") && !me.hasAura(auras.subterfuge)),
      this.useVanish(),
      spell.cast("Thistle Tea", req => me.powerByType(PowerType.Energy) < 50 && !me.hasAura("Thistle Tea"))
    );
  }

  finishers() {
    return new bt.Selector(
      spell.cast("Between the Eyes", on => combat.bestTarget, req => this.shouldUseBetweenTheEyes()),
      spell.cast("Slice and Dice", req => {
        const sliceAndDiceAura = me.getAura(auras.sliceAndDice);
        return !sliceAndDiceAura || sliceAndDiceAura.remaining <= 11000;
      }),
      spell.cast("Dispatch", on => combat.bestTarget, req => this.shouldUseFinisher())
    );
  }

  builders() {
    return new bt.Selector(
      spell.cast("Blade Flurry", req => this.isAoe() && !me.hasAura(auras.bladeFlurry)),
      spell.cast("Ghostly Strike", on => combat.bestTarget),
      spell.cast("Ambush", on => combat.bestTarget, req => this.shouldUseAmbush()),
      spell.cast("Pistol Shot", on => combat.bestTarget, req => this.shouldUsePistolShot()),
      spell.cast("Sinister Strike", on => combat.bestTarget)
    );
  }

  shouldRollTheBones() {
    return this.getRollTheBonesBuffCount() === 0 ||
      (this.getRollTheBonesBuffCount() === 1 && me.hasVisibleAura("Loaded Dice"));
  }

  shouldUseFinisher() {
    return this.getComboPoints() >= 6 ||
      (this.getComboPoints() >= 5 && (me.hasAura(auras.subterfuge) || me.hasAura(auras.audacity) || me.hasAura(auras.opportunity)));
  }

  shouldUseBetweenTheEyes() {
    return this.shouldUseFinisher() && (me.hasVisibleAura("Stealth") || me.hasAura(auras.subterfuge));
  }

  shouldUseAmbush() {
    return me.hasAura(auras.audacity) || me.hasVisibleAura("Stealth") || me.hasAura(auras.subterfuge);
  }

  shouldUsePistolShot() {
    return me.hasAura(auras.opportunity) && !this.shouldUseAmbush();
  }

  useVanish() {
    return spell.cast("Vanish", req =>
      me.currentParty &&
      me.hasAura("Adrenaline Rush") &&
      spell.getCooldown("Between the Eyes").ready &&
      this.shouldUseFinisher() &&
      !me.hasAura("Stealth") &&
      !me.hasAura("Subterfuge")
    );
  }

  isAoe() {
    return combat.getUnitsAroundUnit(me, 8).length > 1;
  }

  shouldUseGhostlyStrike() {
    return !spell.getCooldown("Ghostly Strike").ready && this.getComboPoints() >= 4;
  }

  getComboPoints() {
    return me.powerByType(PowerType.ComboPoints);
  }

  getRollTheBonesBuffCount() {
    const rollTheBonesBuffs = [
      "Broadside",
      "Buried Treasure",
      "Grand Melee",
      "Ruthless Precision",
      "Skull and Crossbones",
      "True Bearing"
    ];
    return rollTheBonesBuffs.filter(buff => me.hasAura(buff)).length;
  }

  getCurrentTarget() {
    return me.targetUnit || combat.bestTarget;
  }

  isAoe() {
    return combat.getUnitsAroundUnit(me, 8).length > 1;
  }
}
