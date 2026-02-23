import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";

// Spell IDs for Fire Mage spells
const SPELLS = {
  // Core abilities
  COMBUSTION: 190319,
  FIREBALL: 133,
  FIRE_BLAST: 108853,
  PYROBLAST: 11366,
  SCORCH: 2948,
  FLAMESTRIKE: 2120,
  PHOENIX_FLAMES: 257541,
  METEOR: 153561,
  SHIFTING_POWER: 382440,
  DRAGONS_BREATH: 31661,
  ARCANE_INTELLECT: 1459,
  MIRROR_IMAGE: 55342,

  // Hot streak system
  HOT_STREAK: 48108,
  HEATING_UP: 48107,
  HYPERTHERMIA: 383860,
  HYPTERTHERMIA_AURA: 383874,
  
  // Frostfire talents and effects
  FROSTFIRE_BOLT: 431044,
  FROSTFIRE_MASTERY: 431038,
  FROSTFIRE_EMPOWERMENT: 431176,
  EXCESS_FROST: 438600,
  
  // Sunfury talents
  SPELLFIRE_SPHERES: 448601,
  GLORIOUS_INCANDESCENCE: 449394,
  
  // Other talents and effects
  SUN_KINGS_BLESSING: 383886,
  IMPROVED_SCORCH: 383604,
  FIREFALL: 384033,
  MARK_OF_THE_FIRELORD: 450325,
  QUICKFLAME: 450807,
  FLAME_PATCH: 205037,
  FIRESTARTER: 205026,
  IMPROVED_SCORCH_DEBUFF: 383604,
  HEAT_SHIMMER: 457735
};

/**
 * Behavior implementation for Fire Mage
 * Strictly follows SIMC APL rotation
 */
export class FireMageBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.Mage.Fire;
  name = "FW Fire Mage";
  version = 1;

  // Initialize variables from precombat APL
  castRemainsTime = 0.3;
  poolingTime = 1000;
  ffCombustionFlamestrike = 4;
  ffFillerFlamestrike = 4;
  sfCombustionFlamestrike = 3;
  sfFillerFlamestrike = 3;
  combustionPrecastTime = 0;

  build() {
    return new bt.Selector(
      Common.waitForNotMounted(),
      Common.waitForCastOrChannel(),
      // Precombat actions
      this.precombat(),
      // Check target validity
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      // Main action list selector
      new bt.Selector(
        // actions=call_action_list,name=cds,if=!(buff.hot_streak.up&prev_gcd.1.scorch)
        new bt.Decorator(
          () => !(me.hasAura(48108) && this.lastGcdWas("Scorch")),
          this.cooldowns(),
          new bt.Action(() => bt.Status.Success)
        ),
        // actions+=/run_action_list,name=ff_combustion,if=talent.frostfire_bolt&(cooldown.combustion.remains<=variable.combustion_precast_time|buff.combustion.react|buff.combustion.remains>5)
        new bt.Decorator(
          () => this.hasTalent(431044) && (
            Spell.getCooldown("Combustion").timeleft <= this.combustionPrecastTime || 
            me.hasAura(190319) || 
            this.getAuraRemainingTime(190319) > 5
          ),
          this.ffCombustion(),
          new bt.Action(() => bt.Status.Success)
        ),
        // actions+=/run_action_list,name=sf_combustion,if=cooldown.combustion.remains<=variable.combustion_precast_time|buff.combustion.react|buff.combustion.remains>5
        new bt.Decorator(
          () => Spell.getCooldown("Combustion").ready,
          this.sfCombustion(),
          new bt.Action(() => bt.Status.Success)
        ),
        // actions+=/run_action_list,name=ff_filler,if=talent.frostfire_bolt
        new bt.Decorator(
          () => this.hasTalent(431044),
          this.ffFiller(),
          new bt.Action(() => bt.Status.Success)
        ),
        // actions+=/run_action_list,name=sf_filler
        new bt.Decorator(
          () => !Spell.getCooldown("Combustion").ready,
          this.sfFiller(),
          new bt.Action(() => bt.Status.Success)
        ),
       
      )
    );
  }

  precombat() {
    return new bt.Selector(
      // actions.precombat=arcane_intellect
      Spell.cast("Arcane Intellect", () => !me.hasAura(1459)),
      
      // actions.precombat+=/variable,name=cast_remains_time,value=0.3
      new bt.Action(() => {
        this.castRemainsTime = 0.3;
        return bt.Status.Failure;
      }),
      
      // actions.precombat+=/variable,name=pooling_time,value=10+10*talent.frostfire_bolt
      new bt.Action(() => {
        this.poolingTime = 10 + (this.hasTalent(431044) ? 10 : 0);
        return bt.Status.Failure;
      }),
      
      // actions.precombat+=/variable,name=ff_combustion_flamestrike,if=talent.frostfire_bolt,value=4+talent.firefall*99-(talent.mark_of_the_firelord&talent.quickflame&talent.firefall)*96+(!talent.mark_of_the_firelord&!talent.quickflame&!talent.flame_patch)*99+(talent.mark_of_the_firelord&!(talent.quickflame|talent.flame_patch))*2+(!talent.mark_of_the_firelord&(talent.quickflame|talent.flame_patch))*3
      new bt.Action(() => {
        if (this.hasTalent(431044)) {
          this.ffCombustionFlamestrike = 4 + 
            (this.hasTalent(384033) ? 99 : 0) -
            (this.hasTalent(450325) && this.hasTalent(450807) && this.hasTalent(384033) ? 96 : 0) +
            (!this.hasTalent(450325) && !this.hasTalent(450807) && !this.hasTalent(205037) ? 99 : 0) +
            (this.hasTalent(450325) && !(this.hasTalent(450807) || this.hasTalent(205037)) ? 2 : 0) +
            (!this.hasTalent(450325) && (this.hasTalent(450807) || this.hasTalent(205037)) ? 3 : 0);
        }
        return bt.Status.Failure;
      }),
      
      // actions.precombat+=/variable,name=ff_filler_flamestrike,if=talent.frostfire_bolt,value=4+talent.firefall*99-(talent.mark_of_the_firelord&talent.flame_patch&talent.firefall)*96+(!talent.mark_of_the_firelord&!talent.quickflame&!talent.flame_patch)*99+(talent.mark_of_the_firelord&!(talent.quickflame|talent.flame_patch))*2+(!talent.mark_of_the_firelord&(talent.quickflame|talent.flame_patch))*3
      new bt.Action(() => {
        if (this.hasTalent(431044)) {
          this.ffFillerFlamestrike = 4 + 
            (this.hasTalent(384033) ? 99 : 0) -
            (this.hasTalent(450325) && this.hasTalent(205037) && this.hasTalent(384033) ? 96 : 0) +
            (!this.hasTalent(450325) && !this.hasTalent(450807) && !this.hasTalent(205037) ? 99 : 0) +
            (this.hasTalent(450325) && !(this.hasTalent(450807) || this.hasTalent(205037)) ? 2 : 0) +
            (!this.hasTalent(450325) && (this.hasTalent(450807) || this.hasTalent(205037)) ? 3 : 0);
        }
        return bt.Status.Failure;
      }),
      
      // actions.precombat+=/variable,name=sf_combustion_flamestrike,if=talent.spellfire_spheres,value=5+(!talent.mark_of_the_firelord)*99+(!(talent.flame_patch|talent.quickflame)&talent.firefall)*99+talent.firefall+(!(talent.flame_patch|talent.quickflame))*3
      new bt.Action(() => {
        if (this.hasTalent(448601)) {
          this.sfCombustionFlamestrike = 5 + 
            (!this.hasTalent(450325) ? 99 : 0) +
            (!(this.hasTalent(205037) || this.hasTalent(450807)) && this.hasTalent(384033) ? 99 : 0) +
            (this.hasTalent(384033) ? 1 : 0) +
            (!(this.hasTalent(205037) || this.hasTalent(450807)) ? 3 : 0);
        }
        return bt.Status.Failure;
      }),
      
      // actions.precombat+=/variable,name=sf_filler_flamestrike,if=talent.spellfire_spheres,value=4+talent.firefall+!talent.mark_of_the_firelord+!(talent.flame_patch|talent.quickflame)+(!talent.mark_of_the_firelord&!(talent.flame_patch|talent.quickflame))*2+(!talent.mark_of_the_firelord&!(talent.flame_patch|talent.quickflame)&talent.firefall)*99
      new bt.Action(() => {
        if (this.hasTalent(448601)) {
          this.sfFillerFlamestrike = 4 +
            (this.hasTalent(384033) ? 1 : 0) +
            (!this.hasTalent(450325) ? 1 : 0) +
            (!(this.hasTalent(205037) || this.hasTalent(450807)) ? 1 : 0) +
            (!this.hasTalent(450325) && !(this.hasTalent(205037) || this.hasTalent(450807)) ? 2 : 0) +
            (!this.hasTalent(450325) && !(this.hasTalent(205037) || this.hasTalent(450807)) && this.hasTalent(384033) ? 99 : 0);
        }
        return bt.Status.Failure;
      }),
      
      // Mirror Image precombat
      Spell.cast("Mirror Image", () => true),
      
      // actions.precombat+=/frostfire_bolt,if=talent.frostfire_bolt
      Spell.cast("Frostfire Bolt", () => this.hasTalent(431044)),
      
      // actions.precombat+=/pyroblast
      // Spell.cast("Pyroblast", () => true)
    );
  }

  cooldowns() {
    return new bt.Selector(
      // actions.cds=phoenix_flames,if=time=0&!talent.firestarter
      Spell.cast("Phoenix Flames", () => false), // Skip for now as it's for time=0 (startup)
      
      // actions.cds+=/variable,name=combustion_precast_time,value=(talent.frostfire_bolt*(cooldown.meteor.ready+action.fireball.cast_time*!improved_scorch.active+action.scorch.cast_time*improved_scorch.active)+talent.spellfire_spheres*action.scorch.cast_time)-variable.cast_remains_time
      new bt.Action(() => {
        const meteorReady = this.hasSpell(SPELLS.METEOR) && this.getSpellCooldown(SPELLS.METEOR).ready ? 1 : 0;
        const fireballCastTime = !this.isImprovedScorchActive() ? Spell.getSpell(SPELLS.FIREBALL).castTime / 1000 : 0;
        const scorchCastTime = this.isImprovedScorchActive() ? Spell.getSpell(SPELLS.SCORCH).castTime / 1000 : 0;
        
        this.combustionPrecastTime = ((this.hasTalent(SPELLS.FROSTFIRE_BOLT) ? (meteorReady + fireballCastTime + scorchCastTime) : 0) +
          (this.hasTalent(SPELLS.SPELLFIRE_SPHERES) ? scorchCastTime : 0)) - this.castRemainsTime;
        
        return bt.Status.Failure;
      }),
      
      // Items, Racials and Externals
      Spell.cast("Berserking", () => me.hasAura(190319) && this.getAuraRemainingTime(190319) > 7),
      Spell.cast("Blood Fury", () => !this.hasTalent(383886) && (Spell.getCooldown("Combustion").timeleft <= this.combustionPrecastTime || me.hasAura(190319) && this.getAuraRemainingTime(190319) > 7)),
      Spell.cast("Fireblood", () => me.hasAura(190319) && this.getAuraRemainingTime(190319) > 7),
      Spell.cast("Ancestral Call", () => !this.hasTalent(383886) && (Spell.getCooldown("Combustion").timeleft <= this.combustionPrecastTime || me.hasAura(190319) && this.getAuraRemainingTime(190319) > 7))
    );
  }

  ffCombustion() {
    return new bt.Selector(
      // actions.ff_combustion=combustion,use_off_gcd=1,use_while_casting=1,if=buff.combustion.down
      Spell.cast("Combustion", () => 
        this.hasSpell(SPELLS.COMBUSTION) && 
        !me.hasAura(SPELLS.COMBUSTION)
      ),
      
      // actions.ff_combustion+=/meteor,if=buff.combustion.down|buff.combustion.remains>2
      Spell.cast("Meteor", () => 
        this.hasSpell(SPELLS.METEOR) && 
        (!me.hasAura(SPELLS.COMBUSTION) || this.getAuraRemainingTime(SPELLS.COMBUSTION) > 2)
      ),
      
      // actions.ff_combustion+=/scorch,if=buff.combustion.down&(buff.heat_shimmer.react&talent.improved_scorch|improved_scorch.active)&!prev_gcd.1.scorch
      Spell.cast("Scorch", () => 
        !me.hasAura(SPELLS.COMBUSTION) && 
        ((me.hasAura(SPELLS.HEAT_SHIMMER) && this.hasTalent(SPELLS.IMPROVED_SCORCH)) || this.isImprovedScorchActive()) && 
        !this.lastGcdWas("Scorch")
      ),
      
      // actions.ff_combustion+=/flamestrike,if=buff.fury_of_the_sun_king.up&active_enemies>=variable.ff_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.SUN_KINGS_BLESSING) && 
        this.getEnemiesInRange(10) >= this.ffCombustionFlamestrike
      ),
      
      // actions.ff_combustion+=/pyroblast,if=buff.fury_of_the_sun_king.up
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.SUN_KINGS_BLESSING)),
      
      // actions.ff_combustion+=/fireball,if=buff.combustion.down
      Spell.cast("Fireball", () => !me.hasAura(SPELLS.COMBUSTION)),
      
      // actions.ff_combustion+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&gcd.remains<gcd.max&buff.combustion.up&!buff.hot_streak.react&hot_streak_spells_in_flight+buff.heating_up.react*(gcd.remains>0)<2&(buff.fury_of_the_sun_king.down|action.pyroblast.executing)
      Spell.cast("Fire Blast", () => 
        this.hasSpell(SPELLS.FIRE_BLAST) && 
        this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
        this.getGcdRemains() < 1.5 && 
        me.hasAura(SPELLS.COMBUSTION) && 
        !me.hasAura(SPELLS.HOT_STREAK) && 
        (me.hasAura(SPELLS.HEATING_UP) ? 1 : 0) * (this.getGcdRemains() > 0 ? 1 : 0) < 2 && 
        !me.hasAura(SPELLS.SUN_KINGS_BLESSING)
      ),
      
      // actions.ff_combustion+=/flamestrike,if=buff.hyperthermia.react&active_enemies>=variable.ff_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HYPERTHERMIA_AURA) && 
        this.getEnemiesInRange(10) >= this.ffCombustionFlamestrike
      ),
      
      // actions.ff_combustion+=/flamestrike,if=buff.hot_streak.react&active_enemies>=variable.ff_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HOT_STREAK) && 
        this.getEnemiesInRange(10) >= this.ffCombustionFlamestrike
      ),
      
      // actions.ff_combustion+=/pyroblast,if=buff.hyperthermia.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HYPERTHERMIA_AURA)),
      
      // actions.ff_combustion+=/pyroblast,if=buff.hot_streak.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HOT_STREAK)),
      
      // actions.ff_combustion+=/phoenix_flames,if=buff.excess_frost.up&(!action.pyroblast.in_flight|!buff.heating_up.react)
      Spell.cast("Phoenix Flames", () => 
        this.hasSpell(SPELLS.PHOENIX_FLAMES) && 
        me.hasAura(SPELLS.EXCESS_FROST) && 
        me.hasAura(SPELLS.HEATING_UP)
      ),
      
      // actions.ff_combustion+=/fireball
      Spell.cast("Fireball")
    );
  }

  ffFiller() {
    return new bt.Selector(
      // actions.ff_filler=meteor,if=cooldown.combustion.remains>variable.pooling_time
      Spell.cast("Meteor", () => 
        this.hasSpell(SPELLS.METEOR) && 
        this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime
      ),
      
      // actions.ff_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&buff.heating_up.react&(cooldown.combustion.remains>variable.pooling_time|talent.sun_kings_blessing)
      Spell.cast("Fire Blast", () => 
        this.hasSpell(SPELLS.FIRE_BLAST) && 
        this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
        me.hasAura(SPELLS.HEATING_UP) && 
        (this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime || this.hasTalent(SPELLS.SUN_KINGS_BLESSING))
      ),
      
      // actions.ff_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&!buff.heating_up.react&!buff.hot_streak.react&(cooldown.combustion.remains>variable.pooling_time|talent.sun_kings_blessing)
      Spell.cast("Fire Blast", () => 
        this.hasSpell(SPELLS.FIRE_BLAST) && 
        this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
        !me.hasAura(SPELLS.HEATING_UP) && 
        !me.hasAura(SPELLS.HOT_STREAK) && 
        (this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime || this.hasTalent(SPELLS.SUN_KINGS_BLESSING))
      ),
      
      // actions.ff_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&charges=3
      Spell.cast("Fire Blast", () => 
        this.hasSpell(SPELLS.FIRE_BLAST) && 
        this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
        Spell.getCharges(SPELLS.FIRE_BLAST) === 3
      ),
      
      // actions.ff_filler+=/scorch,if=(improved_scorch.active|buff.heat_shimmer.react&talent.improved_scorch)&debuff.improved_scorch.remains<3*gcd.max&!prev_gcd.1.scorch
      Spell.cast("Scorch", () => 
        (this.isImprovedScorchActive() || (me.hasAura(SPELLS.HEAT_SHIMMER) && this.hasTalent(SPELLS.IMPROVED_SCORCH))) && 
        this.getDebuffRemainingTime(SPELLS.IMPROVED_SCORCH_DEBUFF) < 3 * 1.5 && 
        !this.lastGcdWas("Scorch")
      ),
      
      // actions.ff_filler+=/flamestrike,if=buff.fury_of_the_sun_king.up&active_enemies>=variable.ff_filler_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.SUN_KINGS_BLESSING) && 
        this.getEnemiesInRange(10) >= this.ffFillerFlamestrike
      ),
      
      // actions.ff_filler+=/flamestrike,if=buff.hyperthermia.react&active_enemies>=variable.ff_filler_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HYPERTHERMIA_AURA) && 
        this.getEnemiesInRange(10) >= this.ffFillerFlamestrike
      ),
      
      // actions.ff_filler+=/flamestrike,if=prev_gcd.1.scorch&buff.heating_up.react&active_enemies>=variable.ff_filler_flamestrike
      Spell.cast("Flamestrike", () => 
        this.lastGcdWas("Scorch") && 
        me.hasAura(SPELLS.HEATING_UP) && 
        this.getEnemiesInRange(10) >= this.ffFillerFlamestrike
      ),
      
      // actions.ff_filler+=/flamestrike,if=buff.hot_streak.react&active_enemies>=variable.ff_filler_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HOT_STREAK) && 
        this.getEnemiesInRange(10) >= this.ffFillerFlamestrike
      ),
      
      // actions.ff_filler+=/pyroblast,if=buff.fury_of_the_sun_king.up
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.SUN_KINGS_BLESSING)),
      
      // actions.ff_filler+=/pyroblast,if=buff.hyperthermia.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HYPERTHERMIA_AURA)),
      
      // actions.ff_filler+=/pyroblast,if=prev_gcd.1.scorch&buff.heating_up.react
      Spell.cast("Pyroblast", () => this.lastGcdWas("Scorch") && me.hasAura(SPELLS.HEATING_UP)),
      
      // actions.ff_filler+=/pyroblast,if=buff.hot_streak.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HOT_STREAK)),
      
      // actions.ff_filler+=/shifting_power,if=cooldown.combustion.remains>10&!firestarter.active
      Spell.cast("Shifting Power", () => 
        this.hasSpell(SPELLS.SHIFTING_POWER) && 
        this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > 10 && 
        !this.isFirestarterActive()
      ),
      
      // actions.ff_filler+=/fireball,if=talent.sun_kings_blessing&buff.frostfire_empowerment.react
      Spell.cast("Fireball", () => 
        this.hasTalent(SPELLS.SUN_KINGS_BLESSING) && 
        me.hasAura(SPELLS.FROSTFIRE_EMPOWERMENT)
      ),
      
      // actions.ff_filler+=/phoenix_flames,if=buff.excess_frost.up|talent.sun_kings_blessing
      Spell.cast("Phoenix Flames", () => 
        this.hasSpell(SPELLS.PHOENIX_FLAMES) && 
        (me.hasAura(SPELLS.EXCESS_FROST) || this.hasTalent(SPELLS.SUN_KINGS_BLESSING))
      ),
      
      // actions.ff_filler+=/scorch,if=talent.sun_kings_blessing&(scorch_execute.active|buff.heat_shimmer.react)
      Spell.cast("Scorch", () => 
        this.hasTalent(SPELLS.SUN_KINGS_BLESSING) && 
        (this.isScorchExecuteActive() || me.hasAura(SPELLS.HEAT_SHIMMER))
      ),
      
      // actions.ff_filler+=/fireball
      Spell.cast("Fireball")
    );
  }

  sfCombustion() {
    return new bt.Selector(
      // actions.sf_combustion=combustion,use_off_gcd=1,use_while_casting=1,if=buff.combustion.down
      Spell.cast("Combustion", () => 
        this.hasSpell(SPELLS.COMBUSTION) && 
        !me.hasAura(SPELLS.COMBUSTION)
      ),
      
      // actions.sf_combustion+=/scorch,if=buff.combustion.down
      Spell.cast("Scorch", () => !me.hasAura(SPELLS.COMBUSTION)),
      
      // actions.sf_combustion+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&gcd.remains<gcd.max&buff.combustion.up&!buff.hot_streak.react&hot_streak_spells_in_flight+buff.heating_up.react*(gcd.remains>0)<2
      Spell.cast("Fire Blast", () => 
        this.hasSpell(SPELLS.FIRE_BLAST) && 
        this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
        this.getGcdRemains() < 1.5 && 
        me.hasAura(SPELLS.COMBUSTION) && 
        !me.hasAura(SPELLS.HOT_STREAK) && 
        (me.hasAura(SPELLS.HEATING_UP) ? 1 : 0) * (this.getGcdRemains() > 0 ? 1 : 0) < 2
      ),
      
      // actions.sf_combustion+=/flamestrike,if=buff.hyperthermia.react&active_enemies>=variable.sf_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HYPERTHERMIA_AURA) && 
        this.getEnemiesInRange(10) >= this.sfCombustionFlamestrike
      ),
      
      // actions.sf_combustion+=/flamestrike,if=buff.hot_streak.react&active_enemies>=variable.sf_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        me.hasAura(SPELLS.HOT_STREAK) && 
        this.getEnemiesInRange(10) >= this.sfCombustionFlamestrike
      ),
      
      // actions.sf_combustion+=/flamestrike,if=prev_gcd.1.scorch&buff.heating_up.react&active_enemies>=variable.sf_combustion_flamestrike
      Spell.cast("Flamestrike", () => 
        this.lastGcdWas("Scorch") && 
        me.hasAura(SPELLS.HEATING_UP) && 
        this.getEnemiesInRange(10) >= this.sfCombustionFlamestrike
      ),
      
      // actions.sf_combustion+=/pyroblast,if=buff.hyperthermia.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HYPERTHERMIA_AURA)),
      
      // actions.sf_combustion+=/pyroblast,if=buff.hot_streak.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HOT_STREAK)),
      
      // actions.sf_combustion+=/pyroblast,if=prev_gcd.1.scorch&buff.heating_up.react
      Spell.cast("Pyroblast", () => this.lastGcdWas("Scorch") && me.hasAura(SPELLS.HEATING_UP)),
      
      // actions.sf_combustion+=/scorch,if=buff.heat_shimmer.react&!scorch_execute.active
      Spell.cast("Scorch", () => me.hasAura(SPELLS.HEAT_SHIMMER) && !this.isScorchExecuteActive()),
      
      // actions.sf_combustion+=/phoenix_flames
      Spell.cast("Phoenix Flames", () => this.hasSpell(SPELLS.PHOENIX_FLAMES)),
      
      // actions.sf_combustion+=/scorch
      Spell.cast("Scorch")
    );
  }

  sfFiller() {
    return new bt.Selector(
      // actions.sf_filler=fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&buff.heating_up.react&buff.hyperthermia.react&cooldown.combustion.remains>variable.pooling_time
      Spell.cast("Fire Blast", () => 
        
        me.hasVisibleAuraByMe(SPELLS.HEATING_UP) ||
        me.hasVisibleAuraByMe(SPELLS.HYPERTHERMIA_AURA) ||
        Spell.getCharges(SPELLS.FIRE_BLAST) > 2
      ),
      
      // // actions.sf_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&buff.heating_up.react&cooldown.combustion.remains>variable.pooling_time
      // Spell.cast("Fire Blast", () => 
        
      //   // this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
      //   me.hasAura(SPELLS.HEATING_UP) &&
      //   this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime
      // ),
      
      // // actions.sf_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&!buff.heating_up.react&!buff.hot_streak.react&cooldown.combustion.remains>variable.pooling_time
      // Spell.cast("Fire Blast", () => 
      //   !me.hasAura(SPELLS.HEATING_UP) && 
      //   !me.hasAura(SPELLS.HOT_STREAK) && 
      //   this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime
      // ),
      
      // // actions.sf_filler+=/fire_blast,use_off_gcd=1,use_while_casting=1,if=cooldown_react&charges=3&cooldown.combustion.remains>variable.pooling_time*0.3
      // Spell.cast("Fire Blast", () => 
      //   Spell.getCharges(SPELLS.FIRE_BLAST) === 3 && 
      //   this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime * 0.3
      // ),
      
      // // actions.sf_filler+=/fire_blast,use_off_gcd=1,if=active_enemies>=2&cooldown_react&buff.glorious_incandescence.react&!buff.heating_up.react&!buff.hot_streak.react&cooldown.combustion.remains>variable.pooling_time
      // Spell.cast("Fire Blast", () => 
      //   this.getEnemiesInRange(10) >= 2 && 
      //   this.hasSpell(SPELLS.FIRE_BLAST) && 
      //   this.getSpellCooldown(SPELLS.FIRE_BLAST).ready && 
      //   me.hasAura(SPELLS.GLORIOUS_INCANDESCENCE) && 
      //   !me.hasAura(SPELLS.HEATING_UP) && 
      //   !me.hasAura(SPELLS.HOT_STREAK) && 
      //   this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > this.poolingTime
      // ),
      
      // actions.sf_filler+=/flamestrike,if=buff.hyperthermia.react&active_enemies>=variable.sf_filler_flamestrike
      Spell.cast("Flamestrike", this.getCurrentTarget, () => 
        me.hasAura(SPELLS.HYPERTHERMIA_AURA) && 
        this.enemiesAroundTarget(8) >= 3
      ),
      
      // actions.sf_filler+=/flamestrike,if=buff.hot_streak.react&active_enemies>=variable.sf_filler_flamestrike
      Spell.cast("Flamestrike", this.getCurrentTarget, () => 
        me.hasAura(SPELLS.HOT_STREAK) && 
      this.enemiesAroundTarget(8) >= 3
      ),
      
      // actions.sf_filler+=/flamestrike,if=prev_gcd.1.scorch&buff.heating_up.react&active_enemies>=variable.sf_filler_flamestrike
      Spell.cast("Flamestrike", this.getCurrentTarget, () => 
        this.lastGcdWas("Scorch") && 
        me.hasAura(SPELLS.HEATING_UP) && 
        this.enemiesAroundTarget(8) >= 3
      ),
      
      // actions.sf_filler+=/pyroblast,if=buff.hyperthermia.react
      Spell.cast("Pyroblast", () => me.hasAura(SPELLS.HYPERTHERMIA_AURA)),
      
      // actions.sf_filler+=/pyroblast,if=buff.hot_streak.react&cooldown.combustion.remains>variable.pooling_time*0.3
      Spell.cast("Pyroblast", () => 
        me.hasAura(SPELLS.HOT_STREAK)),
      
      // actions.sf_filler+=/pyroblast,if=prev_gcd.1.scorch&buff.heating_up.react&cooldown.combustion.remains>variable.pooling_time*0.3
      // Spell.cast("Pyroblast", () =>  
      //   me.hasAura(SPELLS.HEATING_UP)
      // ),
      
      // actions.sf_filler+=/shifting_power,if=cooldown.combustion.remains>8
      Spell.cast("Shifting Power", () => 
        this.hasSpell(SPELLS.SHIFTING_POWER) && 
        this.getSpellCooldown(SPELLS.COMBUSTION).timeleft > 8
      ),
      
      // actions.sf_filler+=/scorch,if=buff.heat_shimmer.react
      Spell.cast("Scorch", () => me.hasAura(SPELLS.HEAT_SHIMMER)),
      
      // actions.sf_filler+=/meteor,if=active_enemies>=2
      Spell.cast("Meteor", () => 
        this.hasSpell(SPELLS.METEOR) && 
        this.getEnemiesInRange(10) >= 2
      ),
      
      // actions.sf_filler+=/phoenix_flames
      Spell.cast("Phoenix Flames", () => this.hasSpell(SPELLS.PHOENIX_FLAMES)),
      
      // actions.sf_filler+=/scorch,if=scorch_execute.active
      Spell.cast("Scorch", () => this.isScorchExecuteActive()),
      
      // actions.sf_filler+=/fireball
      Spell.cast("Fireball")
    );
  }

  // Helper methods
  hasTalent(spellId) {
    return Spell.isSpellKnown(spellId);
  }

  hasSpell(spellId) {
    return Spell.isSpellKnown(spellId);
  }

  isImprovedScorchActive() {
    return me.hasAura(SPELLS.IMPROVED_SCORCH);
  }

  isScorchExecuteActive() {
    const target = this.getCurrentTarget();
    return target && target.pctHealth < 30;
  }

  isFirestarterActive() {
    const target = this.getCurrentTarget();
    return this.hasTalent(SPELLS.FIRESTARTER) && target && target.pctHealth > 90;
  }
  
  // Safe cooldown check that first verifies the spell is known
  getSpellCooldown(spellId) {
    if (!this.hasSpell(spellId)) {
      return { timeleft: 9999, ready: false };
    }
    return Spell.getCooldown(spellId);
  }

  getGcdRemains() {
    return Spell.isGlobalCooldown() ? 1.5 - (wow.frameTime - Spell.getSpell(SPELLS.FIREBALL)._lastCastTimes) / 1000 : 0;
  }

  lastGcdWas(spellName) {
    return Spell.getLastSuccessfulSpell() === spellName;
  }

  hotStreakSpellsInFlight() {
    // In practice, this is hard to track precisely. We'll use 0 as a safe default
    return 0;
  }

  enemiesAroundTarget(range) {
    const target = this.getCurrentTarget();
    return target ? target.getUnitsAroundCount(range) : 0;
  }

  getEnemiesInRange(range) {
    return me.getUnitsAroundCount(range);
  }

  getAuraRemainingTime(spellId) {
    const aura = me.getAura(spellId);
    return aura ? aura.remaining / 1000 : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    if (!target) return 0;
    
    const debuff = target.getAuraByMe(debuffName);
    return debuff ? debuff.remaining / 1000 : 0;
  }

  getCurrentTarget() {
    const targetPredicate = unit => Common.validTarget(unit) && me.isFacing(unit);
    const target = me.target;
    if (target !== null && targetPredicate(target)) {
      return target;
    }
    return combat.targets.find(targetPredicate) || null;
  }
}