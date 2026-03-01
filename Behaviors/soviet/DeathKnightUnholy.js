import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import objMgr, { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Pet from "@/Core/Pet";
import Settings from "@/Core/Settings";
import { PowerType } from "@/Enums/PowerType";
import { RaceType } from "@/Enums/UnitEnums";

const auras = {
  darkSuccor: 101568,
  suddenDoom: 81340,
  virulentPlague: 191587,
  festeringScythe: 458123,
  lesserGhoul: 1254252,
  dreadPlague: 1240996,
  darkTransformation: 1233448,
  forbiddenKnowledge: 1242223,
};

const spells = {
  necroticCoil: 1242174,
  graveyard: 383269,
};

export class DeathKnightUnholy extends Behavior {
  name = "Death Knight (Unholy) PVE";
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Unholy
  static settings = [
  ];

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      common.waitForFacing(),
      spell.cast("Raise Ally", on => objMgr.objects.get(wow.GameUI.mouseoverGuid), req => this.mouseoverIsDeadFriend()),
      spell.cast("Raise Dead", on => me, req => !Pet.current),
      spell.interrupt("Mind Freeze"),
      spell.cast("Claw", on => me.target),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          spell.cast("Death Strike", ret => me.pctHealth < 95 && me.hasAura(auras.darkSuccor)),
          spell.cast("Death Strike", ret => me.pctHealth < 45 && me.power > 55),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstCooldowns()
          ),
          new bt.Decorator(
            ret => me.hasAura(auras.forbiddenKnowledge),
            this.forbiddenKnowledgeRotation()
          ),
          this.mainRotation()
        )
      )
    );
  }

  burstCooldowns() {
    return new bt.Selector(
      this.useRacials(),
      this.useTrinkets(),
      spell.cast("Army of the Dead", ret => true),
      spell.cast("Dark Transformation", ret => true),
    );
  }

  mainRotation() {
    return new bt.Selector(
      spell.cast("Outbreak", on => me.target, ret => this.shouldCastOutbreak()),
      spell.cast("Putrefy", on => me.target, ret => this.shouldPutrefy2Charges()),
      spell.cast("Soul Reaper", on => me.target, ret => !!me.target),
      spell.cast("Putrefy", on => me.target, ret => this.isAoE() && this.canPutrefy()),
      spell.cast("Putrefy", on => me.target, ret => !this.isAoE() && this.canPutrefy() && this.getDTCooldownRemaining() >= 15000),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Epidemic", ret => this.isAoE()),
      spell.cast("Death Coil", on => me.target, ret => !this.isAoE() && this.shouldHighPrioritySpend()),
      spell.cast("Festering Strike", on => me.target, ret => this.getLesserGhoulStacks() === 0),
      spell.cast("Scourge Strike", on => me.target, ret => this.getLesserGhoulStacks() >= 1),
      spell.cast("Death Coil", on => me.target, ret => true),
    );
  }

  forbiddenKnowledgeRotation() {
    return new bt.Selector(
      spell.cast("Putrefy", on => me.target, ret => this.shouldPutrefy2Charges()),
      spell.cast("Putrefy", on => me.target, ret => this.isAoE() && this.canPutrefy()),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Graveyard", ret => this.isAoE()),
      spell.cast("Necrotic Coil", on => me.target, ret => !this.isAoE()),
      spell.cast("Festering Strike", on => me.target, ret => this.getLesserGhoulStacks() === 0),
      spell.cast("Scourge Strike", on => me.target, ret => this.getLesserGhoulStacks() >= 1),
    );
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, ret => me.race === RaceType.Orc),
    );
  }

  useTrinkets() {
    return new bt.Selector(
    );
  }

  mouseoverIsDeadFriend() {
    const mouseover = objMgr.objects.get(wow.GameUI.mouseoverGuid);
    if (mouseover && mouseover instanceof wow.CGUnit) {
      return mouseover.deadOrGhost &&
        !mouseover.canAttack &&
        mouseover.guid !== me.guid &&
        me.withinLineOfSight(mouseover);
    }
    return false;
  }

  isAoE() {
    return me.getEnemies(12).length >= 3;
  }

  getLesserGhoulStacks() {
    return me.getAuraStacks(auras.lesserGhoul);
  }

  getDTRemaining() {
    if (!Pet.current) return 0;
    const dt = Pet.current.getAura(auras.darkTransformation);
    return dt ? dt.remaining : 0;
  }

  getDTCooldownRemaining() {
    const cd = spell.getCooldown("Dark Transformation");
    return cd ? cd.timeleft : 0;
  }

  canPutrefy() {
    return me.target && me.targetUnit.pctHealth >= 35 && spell.getCharges("Putrefy") >= 1;
  }

  shouldPutrefy2Charges() {
    return me.target && me.targetUnit.pctHealth >= 35 && spell.getCharges("Putrefy") >= 2;
  }

  shouldHighPrioritySpend() {
    return me.hasAura(auras.suddenDoom) || me.power >= 80;
  }

  shouldCastOutbreak() {
    if (!me.target) return false;
    return !me.targetUnit.hasAuraByMe(auras.virulentPlague);
  }

  hasCooldownsReady() {
    return Combat.burstToggle && (
      !spell.isOnCooldown("Army of the Dead") ||
      !spell.isOnCooldown("Dark Transformation")
    );
  }
}
