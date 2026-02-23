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

const auras = {
  teachingsofthemonastery: 202090,
  jadeEmpowerment: 467317,
  renewingMist: 119611,
  awakenedJadefire: 389387,
  jadefireTeachings: 388026,
  instantVivify: 392883,
  chijiBuff: 343820,
  manaTea: 115867,
  envelopingMist: 124682
}

const spells = {
  manaTea: 115294
}

export class MonkMistweaverBehavior extends Behavior {
  name = "Monk [Mistweaver]";
  context = BehaviorContext.Any;
  specialization = Specialization.Monk.Mistweaver;
  static settings = [
    {
      header: "General",
      options: [
        { type: "slider", uid: "MonkMistweaverManaTeaPercent", text: "Mana Tea Usage Percent", min: 0, max: 100, default: 90 },
      ]
    },
    {
      header: "Single Target Healing",
      options: [
        { type: "slider", uid: "MonkMistweaverLifeCocoonPercent", text: "Life Cocoon Percent", min: 0, max: 100, default: 50 },
        { type: "slider", uid: "MonkMistweaverEnvelopingPercent", text: "Enveloping Mist Percent", min: 0, max: 100, default: 70 },
        { type: "slider", uid: "MonkMistweaverThunderEnvelopingPercent", text: "Thunder Focus + Enveloping Percent", min: 0, max: 100, default: 60 },
        { type: "slider", uid: "MonkMistweaverVivifyPercent", text: "Vivify Percent", min: 0, max: 100, default: 80 },
      ]
    },
    {
      header: "AoE Healing",
      options: [
        { type: "slider", uid: "MonkMistweaverRevivalCount", text: "Revival Count", min: 0, max: 10, default: 4 },
        { type: "slider", uid: "MonkMistweaverRevivalPercent", text: "Revival Percent", min: 0, max: 100, default: 60 },
        { type: "slider", uid: "MonkMistweaverSheilunsGiftCount", text: "Sheilun's Gift Count", min: 0, max: 5, default: 3 },
        { type: "slider", uid: "MonkMistweaverSheilunsGiftPercent", text: "Sheilun's Gift Percent", min: 0, max: 100, default: 70 }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      this.cancelManaTea(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          this.aoeHealingRotation(),
          this.healingRotation(),
          this.manaTeaRestoration(),
          common.waitForTarget(),
          this.damageRotation()
        )
      )
    );
  }

  cancelManaTea() {
    return new bt.Decorator(
      ret => me.pctPower >= 100 && me.isCastingOrChanneling && this.isCastingManaTea(),
      new bt.Action(_ => {
        me.stopCasting();
        return bt.Status.Success;
      })
    );
  }

  getTargetsBelowHealthPercent(healthPercent) {
    return heal.priorityList.filter(p => p.pctHealth <= healthPercent);
  }

  aoeHealingRotation() {
    return new bt.Selector(
      spell.cast("Revival", on => {
        const targets = this.getTargetsBelowHealthPercent(Settings.MonkMistweaverRevivalPercent);
        return targets.length >= Settings.MonkMistweaverRevivalCount ? targets[0] : null;
      }),
      spell.cast("Sheilun's Gift", on => {
        const targets = this.getTargetsBelowHealthPercent(Settings.MonkMistweaverSheilunsGiftPercent);
        return targets.length >= Settings.MonkMistweaverSheilunsGiftCount ? targets[0] : null;
      }),
    );
  }

  healingRotation() {
    return new bt.Selector(
      spell.cast("Life Cocoon", on => heal.priorityList.find(p => p.pctHealth <= Settings.MonkMistweaverLifeCocoonPercent) && combat.targets.find(t => t.target.equals(p.guid))),
      this.thunderEnvelopingMist(),
      this.chijiEnvelopingMist(),
      spell.cast("Vivify", on => heal.priorityList.find(p => p.pctHealth <= Settings.MonkMistweaverVivifyPercent), req => me.hasAura(auras.instantVivify)),
      spell.cast("Enveloping Mist", on => heal.priorityList.find(p => p.pctHealth <= Settings.MonkMistweaverEnvelopingPercent)),
      spell.cast("Renewing Mist", on => heal.priorityList.find(p => !p.hasAuraByMe(auras.renewingMist)))
    );
  }

  damageRotation() {
    return new bt.Selector(
      common.ensureAutoAttack(),
      this.thunderKick(),
      spell.cast("Jadefire Stomp", on => me, req => !me.isMoving() && (!me.hasAura(auras.awakenedJadefire) || !me.hasAura(auras.jadefireTeachings)) && !this.hasChiji()),
      spell.cast("Touch of Death", on => me.target, req => !this.hasChiji()),
      spell.cast("Crackling Jade Lightning", on => me.target, req => spell.getLastSuccessfulSpell() != "Crackling Jade Lightning" && me.hasAura(auras.jadeEmpowerment) && !this.hasChiji()),
      spell.cast("Rising Sun Kick", on => me.target),
      spell.cast("Spinning Crane Kick", on => me, req => combat.getUnitsAroundUnit(me, 10).length > 5),
      spell.cast("Blackout Kick", on => me.target, req => me.getAuraStacks(auras.teachingsofthemonastery) >= 3),
      spell.cast("Tiger Palm", on => me.target),
    );
  }

  thunderKick() {
    return new bt.Decorator(
      () => spell.canCast(spell.getSpell("Rising Sun Kick"), me.target, {}),
      new bt.Sequence(
        spell.cast("Thunder Focus Tea", on => me),
        spell.cast("Rising Sun Kick", on => me.target)
      )
    );
  }

  thunderEnvelopingMist() {
    return new bt.Decorator(
      () => {
        const target = heal.priorityList.find(p => p.pctHealth <= Settings.MonkMistweaverThunderEnvelopingPercent);
        return target && spell.canCast(spell.getSpell("Enveloping Mist"), target, {});
      },
      new bt.Sequence(
        new bt.Action(() => {
          this._thunderEnvelopingTarget = heal.priorityList.find(p => p.pctHealth <= Settings.MonkMistweaverThunderEnvelopingPercent);
          return this._thunderEnvelopingTarget ? bt.Status.Success : bt.Status.Failure;
        }),
        spell.cast("Thunder Focus Tea", on => me),
        spell.cast("Enveloping Mist", on => () => this._thunderEnvelopingTarget)
      )
    );
  }

  chijiEnvelopingMist() {
    return new bt.Decorator(
      () => {
        if (me.getAuraStacks(auras.chijiBuff) < 3) {
          return false;
        }

        const target = heal.priorityList.find(p => !p.hasAuraByMe(auras.envelopingMist));
        return target && spell.canCast(spell.getSpell("Enveloping Mist"), target, {});
      },
      spell.cast("Enveloping Mist", on => heal.priorityList.find(p => !p.hasAuraByMe(auras.envelopingMist)))
    );
  }

  manaTeaRestoration() {
    return new bt.Decorator(
      ret => this.shouldUseManaTeaForMana(),
      spell.cast("Mana Tea", on => me)
    );
  }

  shouldUseManaTeaForMana() {
    const manaTeaStacks = me.getAuraStacks(auras.manaTea);
    if (manaTeaStacks === 0) {
      return false;
    }

    if (manaTeaStacks >= 20 && me.pctPower < 100) {
      return true;
    }

    if (me.pctPower >= Settings.MonkMistweaverManaTeaPercent) {
      return false;
    }

    const manaRestoration = manaTeaStacks * 2;
    const currentMana = me.pctPower;
    const projectedMana = Math.min(100, currentMana + manaRestoration);

    return manaTeaStacks > 0 && projectedMana > currentMana;
  }

  isCastingManaTea() {
    if (!me.isCastingOrChanneling) return false;
    return me.spellInfo.spellChannelId === spells.manaTea;
  }

  hasChiji() {
    const totem = wow.GameUI.totemInfo[0];
    return totem && totem.name === "Chi-Ji";
  }
}
