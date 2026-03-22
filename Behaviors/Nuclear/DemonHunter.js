import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import common from '@/Core/Common';
import spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";

const auras = {
  soulFragments: 203981,
  thrillOfTheFight: 999999, // Replace with actual aura ID
  artOfTheGlaive: 999998, // Replace with actual aura ID
  fieryBrand: 207771,
}

export class NuclearDemonhunterVengeanceBehavior extends Behavior {
  name = "Nuclear Vengeance"
  context = BehaviorContext.Any;
  specialization = Specialization.DemonHunter.Vengeance;

  build() {
    return new bt.Decorator(
      ret => !spell.isGlobalCooldown(),
      new bt.Selector(
        common.waitForNotMounted(),
        common.waitForTarget(),
        common.waitForCastOrChannel(),
        common.waitForFacing(),

        spell.cast("Sigil of Flame", on => me.target),
        spell.cast("Demon Spikes", req => me.pctHealth < 70 && !me.hasAuraByMe("Demon Spikes")),
        new bt.Decorator(
          req => me.isWithinMeleeRange(me.target),
          new bt.Selector(
            spell.cast("Immolation Aura", req => !me.hasAuraByMe("Immolation Aura")),
            spell.cast("Fel Devastation", req => me.power > 50),
            //spell.cast("Metamorphosis"),
            spell.cast("Fracture", req => this.soulFragments() < 4 && me.power < 75),
            spell.cast("Soul Carver"),
            spell.cast("Spirit Bomb", req => this.soulFragments() > 4),
            spell.cast("Fiery Brand", on => me.target, req => me.power > 70),
            spell.cast("Soul Cleave", on => me.target),
          )
        ),
        spell.cast("Throw Glaive"),
      )
    );
  }

  soulFragments() {
    const aura = me.getAuraByMe("Soul Fragments");
    return aura ? aura.stacks : 0;
  }
}
