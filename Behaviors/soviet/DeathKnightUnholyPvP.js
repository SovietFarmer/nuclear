import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { defaultCombatTargeting as Combat } from "@/Targeting/CombatTargeting";
import Specialization from "@/Enums/Specialization";
import common from "@/Core/Common";
import Pet from "@/Core/Pet";
import Spell from "@/Core/Spell";
import { RaceType } from "@/Enums/UnitEnums";

const auras = {
  darkSuccor: 101568,

  suddenDoom: 81340,
  virulentPlague: 191587,
  darkTransformation: 1233448,
  lesserGhoul: 1254252,
  dreadPlague: 1240996,
  festeringScythe: 458123,
  forbiddenKnowledge: 1242223,
};

const spells = {
  necroticCoil: 1242174,
  graveyard: 383269,
};

export class DeathKnightUnholy extends Behavior {
  name = "Death Knight (Unholy) PvP";
  context = BehaviorContext.Any; // PvP or PvE
  specialization = Specialization.DeathKnight.Unholy

  build() {
    return new bt.Selector(
      common.waitForNotSitting(),
      common.waitForNotMounted(),
      common.waitForCastOrChannel(),
      common.waitForTarget(),
      new bt.Decorator(
        ret => me.pet && me.pet.hasVisibleAura(auras.darkTransformation),
        spell.interrupt("Leap", true)
      ),
      spell.interrupt("Gnaw", true),
      common.waitForFacing(),
      spell.cast("Raise Dead", on => me, req => !Pet.current),
      spell.interrupt("Mind Freeze", true),
      spell.cast("Claw", on => me.target),
      spell.cast("Huddle", ret => Pet.current &&
        Pet.current.hasVisibleAura(auras.darkTransformation) &&
        Spell.getTimeSinceLastCast("Dark Transformation") < 5000),
      spell.cast("Strangulate", on => this.strangulateTarget(), ret => me.target && me.target.pctHealth < 70 && this.strangulateTarget() !== undefined),
      spell.cast("Blinding Sleet", on => this.blindingSleetTarget(), ret => this.blindingSleetTarget() !== undefined),
      new bt.Decorator(
        ret => !spell.isGlobalCooldown(),
        new bt.Selector(
          common.waitForNotWaitingForArenaToStart(),
          common.waitForCombat(),
          common.waitForNotSitting(),
          common.waitForNotMounted(),
          common.waitForCastOrChannel(),
          spell.cast("Death Strike", ret => me.pctHealth < 95 && me.hasAura(auras.darkSuccor)),
          spell.cast("Death Strike", ret => me.pctHealth < 55 && (Spell.getTimeSinceLastCast("Death Strike") > 3000 || me.power > 50)),
          new bt.Decorator(
            ret => this.hasCooldownsReady(),
            this.burstDamage()
          ),
          new bt.Decorator(
            ret => me.hasAura(auras.forbiddenKnowledge),
            this.forbiddenKnowledgeRotation()
          ),
          this.sustainedDamage(),
        )
      )
    );
  }

  burstDamage() {
    return new bt.Selector(
      spell.cast("Army of the Dead", ret => true),
      spell.cast("Dark Transformation", ret => true),
      this.useRacials(),
      spell.cast("Soul Reaper", on => me.target, ret => !!me.target),
      spell.cast("Scourge Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() >= 3),
      spell.cast("Death Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),
      spell.cast("Festering Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() < 2),
      spell.cast("Death Coil", on => me.target, ret => me.target && me.power > 40),
    );
  }

  sustainedDamage() {
    return new bt.Selector(
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),
      spell.cast("Putrefy", on => me.target, ret => me.target && spell.getCharges("Putrefy") >= 3),
      spell.cast("Putrefy", on => me.target, ret => me.target &&
        spell.getCharges("Putrefy") >= 2 && !this.burstSoon()),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Death Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),
      spell.cast("Scourge Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() >= 3),
      spell.cast("Festering Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() < 2),
      spell.cast("Death Strike", ret => me.pctHealth < 70 && me.power > 80),
      spell.cast("Death Coil", on => me.target, ret => me.target && me.power > 40),
    );
  }

  forbiddenKnowledgeRotation() {
    return new bt.Selector(
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),
      spell.cast("Putrefy", on => me.target, ret => me.target && spell.getCharges("Putrefy") >= 3),
      spell.cast("Putrefy", on => me.target, ret => me.target &&
        spell.getCharges("Putrefy") >= 2 && !this.burstSoon()),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Necrotic Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),
      spell.cast("Scourge Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() >= 3),
      spell.cast("Festering Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() < 2),
      spell.cast("Death Strike", ret => me.pctHealth < 70 && me.power > 80),
      spell.cast("Necrotic Coil", on => me.target, ret => me.target && me.power > 40),
    );
  }

  burstSoon() {
    if (!Combat.burstToggle) return false;
    const dtCd = spell.getCooldown("Dark Transformation");
    const armyCd = spell.getCooldown("Army of the Dead");
    const dtReady = !dtCd || dtCd.timeleft <= 15000;
    const armyReady = !armyCd || armyCd.timeleft <= 15000;
    return dtReady || armyReady;
  }

  getLesserGhoulStacks() {
    return me.getAuraStacks(auras.lesserGhoul);
  }

  hasCooldownsReady() {
    return Combat.burstToggle && me.target && me.isWithinMeleeRange(me.target) &&
      spell.getCharges("Putrefy") >= 2 && (
        !spell.isOnCooldown("Army of the Dead") ||
        !spell.isOnCooldown("Dark Transformation")
      );
  }

  strangulateTarget() {
    // Get all enemy players within 20 yards and find the first valid healer target
    const nearbyEnemies = me.getPlayerEnemies(20);

    for (const unit of nearbyEnemies) {
      if (unit.isHealer() && !unit.isCCd() && unit.canCC() && unit.getDR("silence") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  blindingSleetTarget() {
    // Get all enemy players within 10 yards
    const nearbyEnemies = me.getPlayerEnemies(10);

    for (const unit of nearbyEnemies) {
      if (unit !== me.target &&
        me.isFacing(unit) &&
        unit.isHealer() &&
        !unit.isCCd() &&
        unit.canCC() &&
        unit.getDR("disorient") === 0) {
        return unit;
      }
    }

    return undefined;
  }

  useRacials() {
    return new bt.Selector(
      spell.cast("Blood Fury", on => me, ret => me.race === RaceType.Orc),
    );
  }
}
