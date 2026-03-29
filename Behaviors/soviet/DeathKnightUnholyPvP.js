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
        ret => me.pet && me.pet.hasAuraByMe(auras.darkTransformation),
        spell.interrupt("Leap", true)
      ),
      spell.interrupt("Gnaw", true),
      common.waitForFacing(),
      spell.cast("Raise Dead", on => me, req => !Pet.current),
      spell.interrupt("Mind Freeze", true),
      spell.cast("Claw", on => me.target),
      spell.cast("Huddle", ret => Pet.current &&
        Pet.current.hasAuraByMe(auras.darkTransformation) &&
        Spell.getTimeSinceLastCast("Dark Transformation") < 5000),
      new bt.Sequence(
        "Strangulate healer",
        new bt.Action(() => {
          if (!me.target || me.target.pctHealth >= 70) {
            return bt.Status.Failure;
          }
          const t = this.strangulateTarget();
          if (!t || !t.isHealer()) {
            return bt.Status.Failure;
          }
          spell._currentTarget = t;
          return bt.Status.Success;
        }),
        spell.castEx("Strangulate")
      ),
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
            this.burstCooldowns()
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

  burstCooldowns() {
    return new bt.Selector(
      this.useRacials(),
      spell.cast("Army of the Dead", ret => true),
      spell.cast("Dark Transformation", ret => true),
      spell.cast("Soul Reaper", on => me.target, ret => !!me.target),
    );
  }

  sustainedDamage() {
    return new bt.Selector(
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),
      spell.cast("Putrefy", on => me.target, ret => me.target && spell.getCharges("Putrefy") >= 3),
      spell.cast("Putrefy", on => me.target, ret => me.target &&
        spell.getCharges("Putrefy") >= 2 && !this.burstSoon()),
      spell.cast("Soul Reaper", on => me.target, ret => !!me.target),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Death Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),
      spell.cast("Scourge Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() >= 3),
      spell.cast("Festering Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() < 2),
      spell.cast("Death Strike", ret => me.pctHealth < 70 && me.power > 80),
      spell.cast("Death Coil", on => me.target, ret => me.target && me.power > 40),
      spell.cast("Scourge Strike", on => me.target, ret => !!me.target),
    );
  }

  forbiddenKnowledgeRotation() {
    return new bt.Selector(
      spell.cast("Outbreak", on => me.target, ret => me.target && !me.targetUnit.hasAuraByMe(auras.virulentPlague)),
      spell.cast("Putrefy", on => me.target, ret => me.target && spell.getCharges("Putrefy") >= 3),
      spell.cast("Putrefy", on => me.target, ret => me.target &&
        spell.getCharges("Putrefy") >= 2 && !this.burstSoon()),
      spell.cast("Soul Reaper", on => me.target, ret => !!me.target),
      spell.cast("Festering Scythe", on => me.target, ret => me.hasAura(auras.festeringScythe)),
      spell.cast("Necrotic Coil", on => me.target, ret => me.target && (me.power > 80 || me.hasAura(auras.suddenDoom))),
      spell.cast("Scourge Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() >= 3),
      spell.cast("Festering Strike", on => me.target, ret => me.target && this.getLesserGhoulStacks() < 2),
      spell.cast("Death Strike", ret => me.pctHealth < 70 && me.power > 80),
      spell.cast("Necrotic Coil", on => me.target, ret => me.target && me.power > 40),
      spell.cast("Scourge Strike", on => me.target, ret => !!me.target),
    );
  }

  burstSoon() {
    if (!Combat.burstToggle) return false;
    const armyCd = spell.getCooldown("Army of the Dead");
    return !armyCd || armyCd.timeleft <= 15000;
  }

  getLesserGhoulStacks() {
    return me.getAuraStacks(auras.lesserGhoul);
  }

  hasCooldownsReady() {
    return Combat.burstToggle && me.target && me.isWithinMeleeRange(me.target) && (
      !spell.isOnCooldown("Army of the Dead") ||
      !spell.isOnCooldown("Dark Transformation")
    );
  }

  strangulateTarget() {
    // Prefer a healer who is not our current kill target (when one exists), then fallback.
    // Sort by distance so iteration order is stable (objMgr order is arbitrary).
    const nearbyEnemies = me.getPlayerEnemies(20).sort((a, b) => me.distanceTo(a) - me.distanceTo(b));

    const isValid = (unit) =>
      unit.isHealer() &&
      me.isFacing(unit) &&
      me.withinLineOfSight(unit) &&
      !unit.isCCd() &&
      unit.canCC() &&
      unit.getDR("silence") === 0;

    for (const unit of nearbyEnemies) {
      if (unit !== me.target && isValid(unit)) {
        return unit;
      }
    }
    for (const unit of nearbyEnemies) {
      if (isValid(unit)) {
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
