import { Behavior, BehaviorContext } from "@/Core/Behavior";
import * as bt from '@/Core/BehaviorTree';
import Specialization from '@/Enums/Specialization';
import Common from '@/Core/Common';
import Spell from "@/Core/Spell";
import { me } from "@/Core/ObjectManager";
import { PowerType } from "@/Enums/PowerType";
import { defaultCombatTargeting as combat } from "@/Targeting/CombatTargeting";
import Settings from "@/Core/Settings";

const auras = {
    // Core Hero Power
    vampiric_strike: 433901, // San'layn
    riders_champion: 444005, // Rider of the Apocalypse
  
    // General Death Knight
    abomination_limb: 383269,
    antimagic_barrier: 205727,
    antimagic_zone: 51052,
    asphyxiate: 221562,
    assimilation: 374383,
    blinding_sleet: 207167,
    blood_draw: 374598,
    blood_scent: 374030,
    brittle: 374504,
    cleaving_strikes: 316916,
    coldthirst: 378848,
    control_undead: 111673,
    death_pact: 48743,
    death_strike: 49998,
    deaths_echo: 356367,
    deaths_reach: 276079,
    enfeeble: 392566,
    gloom_ward: 391571,
    grip_of_the_dead: 273952,
    ice_prison: 454786,
    icebound_fortitude: 48792,
    icy_talons: 194878,
    improved_death_strike: 374277,
    insidious_chill: 391566,
    march_of_darkness: 391546,
    mind_freeze: 47528,
    null_magic: 454842,
    osmosis: 454835,
    permafrost: 207200,
    proliferating_chill: 373930,
    raise_dead: 46585,
    rune_mastery: 374574,
    runic_attenuation: 207104,
    runic_protection: 454788,
    sacrificial_pact: 327574,
    soul_reaper: 343294,
    subduing_grasp: 454822,
    suppression: 374049,
    unholy_bond: 374261,
    unholy_endurance: 389682,
    unholy_ground: 374265,
    unyielding_will: 457574,
    vestigial_shell: 454851,
    veteran_of_the_third_war: 48263,
    will_of_the_necropolis: 206967,
    wraith_walk: 212552,
  
    // Unholy
    all_will_serve: 194916,
    apocalypse: 275699,
    army_of_the_dead: 42650,
    bursting_sores: 207264,
    clawing_shadows: 207311,
    coil_of_devastation: 390270,
    commander_of_the_dead: 390259,
    dark_transformation: 63560,
    death_rot: 377537,
    decomposition: 455398,
    defile: 152280,
    doomed_bidding: 455386,
    ebon_fever: 207269,
    eternal_agony: 390268,
    festering_scythe: 455397,
    festering_strike: 85948,
    festermight: 377590,
    foul_infections: 455396,
    ghoulish_frenzy: 377587,
    harbinger_of_doom: 276023,
    improved_death_coil: 377580,
    improved_festering_strike: 316867,
    infected_claws: 207272,
    magus_of_the_dead: 390196,
    menacing_magus: 455135,
    morbidity: 377592,
    pestilence: 277234,
    plaguebringer: 390175,
    raise_abomination: 455395,
    raise_dead_2: 46584,
    reaping: 377514,
    rotten_touch: 390275,
    runic_mastery: 390166,
    ruptured_viscera: 390236,
    scourge_strike: 55090,
    sudden_doom: 49530,
    summon_gargoyle: 49206,
    superstrain: 390283,
    unholy_assault: 207289,
    unholy_aura: 377440,
    unholy_blight: 460448,
    unholy_pact: 319230,
    vile_contagion: 390279,
  
    // Rider of the Apocalypse
    a_feast_of_souls: 444072,
    apocalypse_now: 444040,
    death_charge: 444010,
    fury_of_the_horsemen: 444069,
    horsemens_aid: 444074,
    hungering_thirst: 444037,
    mawsworn_menace: 444099,
    mograines_might: 444047,
    nazgrims_conquest: 444052,
    on_a_paler_horse: 444008,
    pact_of_the_apocalypse: 444083,
    trollbanes_icy_fury: 444097,
    whitemanes_famine: 444033,
  
    // San'layn
    bloodsoaked_ground: 434033,
    bloody_fortitude: 434136,
    frenzied_bloodthirst: 434075,
    gift_of_the_sanlayn: 434152,
    incite_terror: 434151,
    infliction_of_sorrow: 434143,
    newly_turned: 433934,
    pact_of_the_sanlayn: 434261,
    sanguine_scent: 434263,
    the_blood_is_life: 434260,
    vampiric_aura: 434100,
    vampiric_speed: 434028,
    visceral_strength: 434157,
    
    // Missing auras added
    death_and_decay: 43265,
    unholy_strength: 53365,
    runic_corruption: 51460,
    essence_of_the_blood_queen: 347607 // Approximate ID, adjust if needed
  };

export class DeathKnightUnholyBehavior extends Behavior {
  context = BehaviorContext.Any;
  specialization = Specialization.DeathKnight.Unholy;
  name = "FW Death Knight Unholy";
  version = 1;

  // Class variables to store APL variables
  variableApocTiming = 0;
  variablePopWounds = false;
  variablePoolingRunicPower = false;

  

  static settings = [
    {
      header: "Unholy DK Settings",
      options: [
        {
          uid: "AoEThreshold",
          text: "AoE Target Threshold",
          type: "slider",
          min: 2,
          max: 6,
          default: 3
        },
        {
          uid: "UseArmyOfTheDead",
          text: "Use Army of the Dead",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseAbomination",
          text: "Use Raise Abomination",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseGargoyle",
          text: "Use Summon Gargoyle",
          type: "checkbox",
          default: true
        },
        {
          uid: "UseApocalypse",
          text: "Use Apocalypse",
          type: "checkbox",
          default: true
        },
        {
          uid: "SaveCooldownsForBurst",
          text: "Save Cooldowns for Burst",
          type: "checkbox",
          default: false
        }
      ]
    }
  ];

  build() {
    return new bt.Selector(
      Common.waitForCastOrChannel(),
      Common.waitForNotMounted(),
    //   Spell.cast("Raise Dead", () => !me.hasPet() && Spell.isSpellKnown("Raise Dead")),
      Spell.interrupt("Mind Freeze", false),
      new bt.Action(() => {
        if (this.getCurrentTarget() === null) {
          return bt.Status.Success;
        }
        return bt.Status.Failure;
      }),
      this.determineActionList()
    );
  }

  determineActionList() {
    return new bt.Selector(
      // Set up variables
      new bt.Action(() => {
        this.variableApocTiming = (Spell.getCooldown("Apocalypse").timeleft < 5 && this.getDebuffStacks("Festering Wound") < 1 && Spell.getCooldown("Unholy Assault").timeleft > 5) ? 3 : 0;
        this.variablePopWounds = (Spell.getCooldown("Apocalypse").timeleft > this.variableApocTiming || !this.hasTalent("Apocalypse")) && 
          ((this.getDebuffStacks("Festering Wound") >= 1 && Spell.getCooldown("Unholy Assault").timeleft < 20 && this.hasTalent("Unholy Assault") && this.getEnemyCount() === 1) || 
          (this.getCurrentTarget().hasAuraByMe("Rotten Touch") && this.getDebuffStacks("Festering Wound") >= 1) || 
          (this.getDebuffStacks("Festering Wound") >= (4 - (this.hasTalent("Raise Abomination") && me.pet && me.pet.active ? 1 : 0)))) || 
          (this.getTargetTimeRemaining() < 5 && this.getDebuffStacks("Festering Wound") >= 1);
        this.variablePoolingRunicPower = this.hasTalent("Vile Contagion") && Spell.getCooldown("Vile Contagion").timeleft < 5 && me.powerByType(PowerType.RunicPower) < 30;
        
        return bt.Status.Failure; // Continue to next selector
      }),
      // Call action list based on enemy count and talent
      new bt.Decorator(
        () => this.getEnemyCount() >= Settings.AoEThreshold && this.hasTalent("Vampiric Strike"),
        this.aoeBurstSanAction(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() >= Settings.AoEThreshold && !this.hasTalent("Vampiric Strike"),
        this.aoeBurstAction(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() === 2 && this.hasTalent("Vampiric Strike"),
        this.cleaveActionSan(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() === 2 && !this.hasTalent("Vampiric Strike"),
        this.cleaveAction(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() === 1 && this.hasTalent("Gift of the San'layn") && !Spell.getCooldown("Dark Transformation").ready && !me.hasAura(auras.gift_of_the_sanlayn) && me.getAuraRemainingTime("Essence of the Blood Queen") < Spell.getCooldown("Dark Transformation").timeleft + 3,
        this.sanFishingAction(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() === 1 && this.hasTalent("Vampiric Strike"),
        this.singleTargetSanAction(),
        new bt.Action(() => bt.Status.Success)
      ),
      new bt.Decorator(
        () => this.getEnemyCount() === 1 && !this.hasTalent("Vampiric Strike"),
        this.singleTargetAction(),
        new bt.Action(() => bt.Status.Success)
      )
    );
  }

  useTrinkets() {
    return new bt.Selector(
      Common.useEquippedItemByName("Treacherous Transmitter", () => ((this.getEnemyCount() > 1 || this.getEnemyCount() === 1) && Spell.getCooldown("Dark Transformation").timeleft < 10)),
      Common.useEquippedItemByName("Fyralath, the Dreamrender", () => this.getCurrentTarget().hasAura("Mark of Fyralath") && (this.getEnemyCount() < 5 || this.getEnemyCount() > 21 || this.getTargetTimeRemaining() < 4))
    );
  }

  useRacials() {
    return new bt.Selector(
      Spell.cast("Blood Fury", () => this.shouldUseOffensiveCDs()),
      Spell.cast("Berserking", () => this.shouldUseOffensiveCDs()),
      Spell.cast("Arcane Torrent", () => me.powerByType(PowerType.RunicPower) < 20 && me.getReadyRunes() < 2),
      Spell.cast("Lights Judgment", () => me.hasAura(auras.unholy_strength) && (!this.hasTalent("Festermight") || me.hasAura(auras.festermight))),
      Spell.cast("Ancestral Call", () => this.shouldUseOffensiveCDs()),
      Spell.cast("Fireblood", () => this.shouldUseOffensiveCDs()),
      Spell.cast("Bag of Tricks", () => this.getEnemyCount() === 1 && (me.hasAura(auras.unholy_strength)))
    );
  }

  // Shared cooldowns
  sharedCooldowns() {
    return new bt.Selector(
      Spell.cast("Army of the Dead", () => Settings.UseArmyOfTheDead && ((this.hasTalent("Commander of the Dead") && Spell.getCooldown("Dark Transformation").timeleft < 5) || (!this.hasTalent("Commander of the Dead") && this.getEnemyCount() >= 1) || this.getTargetTimeRemaining() < 35)),
      Spell.cast("Raise Abomination", () => Settings.UseAbomination && this.hasTalent("Raise Abomination")),
      Spell.cast("Summon Gargoyle", () => Settings.UseGargoyle && this.hasTalent("Summon Gargoyle") && ((me.hasAura(auras.commander_of_the_dead) || (!this.hasTalent("Commander of the Dead") && this.getEnemyCount() >= 1)) || this.getTargetTimeRemaining() < 25)),
      Spell.cast("Anti-Magic Shell", () => me.powerByType(PowerType.RunicPower) < 30 && me.getReadyRunes() < 2)
    );
  }
  
  // Non-San'layn Cooldowns
  cdsSingleTarget() {
    return new bt.Selector(
      Spell.cast("Dark Transformation", () => this.getEnemyCount() === 1 && (Spell.getCooldown("Apocalypse").timeleft < 8 || !this.hasTalent("Apocalypse") || this.getEnemyCount() >= 1) || this.getTargetTimeRemaining() < 20),
      Spell.cast("Unholy Assault", () => this.getEnemyCount() === 1 && (Spell.getCooldown("Apocalypse").timeleft < 1.5 || !this.hasTalent("Apocalypse") || this.getEnemyCount() >= 2 && me.hasAura(auras.dark_transformation)) || this.getTargetTimeRemaining() < 20),
      Spell.cast("Apocalypse", () => Settings.UseApocalypse && this.getEnemyCount() === 1 || this.getTargetTimeRemaining() < 20),
      Spell.cast("Outbreak", () => this.getTargetTimeRemaining() > this.getDebuffRemainingTime("Virulent Plague") && this.getDebuffTicksRemaining("Virulent Plague") < 5 && (this.getDebuffRemainingTime("Virulent Plague") === 0 || this.hasTalent("Superstrain") && (this.getDebuffRemainingTime("Frost Fever") === 0 || this.getDebuffRemainingTime("Blood Plague") === 0)) && (!this.hasTalent("Unholy Blight") || this.hasTalent("Plaguebringer")) && (!this.hasTalent("Raise Abomination") || this.hasTalent("Raise Abomination") && Spell.getCooldown("Raise Abomination").timeleft > this.getDebuffTicksRemaining("Virulent Plague") * 3)),
      Spell.cast("Abomination Limb", () => this.getEnemyCount() === 1 && !me.hasAura(auras.sudden_doom) && (me.hasAura(auras.festermight) && me.getAuraStacks("Festermight") > 8 || !this.hasTalent("Festermight")) && (me.hasPet() && me.pet.timeRemaining < 5 || !this.hasTalent("Apocalypse")) && this.getDebuffStacks("Festering Wound") <= 2 || this.getTargetTimeRemaining() < 12)
    );
  }

  // San'layn Cooldowns
  cdsSingleTargetSan() {
    return new bt.Selector(
      Spell.cast("Dark Transformation", () => this.getEnemyCount() >= 1 && this.getEnemyCount() === 1 && (this.hasTalent("Apocalypse") && me.hasPet() || !this.hasTalent("Apocalypse")) || this.getTargetTimeRemaining() < 20),
      Spell.cast("Unholy Assault", () => this.getEnemyCount() === 1 && (me.hasAura(auras.dark_transformation) && this.getAuraRemainingTime("Dark Transformation") < 12) || this.getTargetTimeRemaining() < 20),
      Spell.cast("Apocalypse", () => Settings.UseApocalypse && this.getEnemyCount() === 1 || this.getTargetTimeRemaining() < 20),
      Spell.cast("Outbreak", () => this.getTargetTimeRemaining() > this.getDebuffRemainingTime("Virulent Plague") && this.getDebuffTicksRemaining("Virulent Plague") < 5 && (this.getDebuffRemainingTime("Virulent Plague") === 0 || this.hasTalent("Morbidity") && me.hasAura(auras.infliction_of_sorrow) && this.hasTalent("Superstrain") && this.getDebuffRemainingTime("Frost Fever") === 0 && this.getDebuffRemainingTime("Blood Plague") === 0) && (!this.hasTalent("Unholy Blight") || this.hasTalent("Unholy Blight") && Spell.getCooldown("Dark Transformation").timeleft > 0) && (!this.hasTalent("Raise Abomination") || this.hasTalent("Raise Abomination") && Spell.getCooldown("Raise Abomination").timeleft > 0)),
      Spell.cast("Abomination Limb", () => this.getEnemyCount() >= 1 && this.getEnemyCount() === 1 && !me.hasAura(auras.gift_of_the_sanlayn) && !me.hasAura(auras.sudden_doom) && me.hasAura(auras.festermight) && this.getDebuffStacks("Festering Wound") <= 2 || !me.hasAura(auras.gift_of_the_sanlayn) && this.getTargetTimeRemaining() < 12)
    );
  }

  // AoE Burst (San'layn)
  aoeBurstSanAction() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      // AoE Cooldowns
      Spell.cast("Dark Transformation", () => this.getEnemyCount() > 1 && (me.hasAura(auras.death_and_decay) || this.getEnemyCount() <= 3)),
      Spell.cast("Unholy Assault", () => this.getEnemyCount() > 1 && (Spell.getCooldown("Vile Contagion").timeleft < 6 || Spell.getCooldown("Vile Contagion").timeleft > 40 || !this.hasTalent("Vile Contagion")) || this.getTargetTimeRemaining() < 20),
      Spell.cast("Vile Contagion", () => this.getDebuffStacks("Festering Wound") >= 4 && (this.getAddTimeRemaining() > 4 || this.getAddTimeRemaining() <= 0 && this.getTargetTimeRemaining() > 4) && (this.getAddTimeRemaining() <= 11 || Spell.getCooldown("Death and Decay").timeleft < 3 || me.hasAura(auras.death_and_decay) && this.getDebuffStacks("Festering Wound") >= 4) || this.getEnemyCount() > 1 && this.getDebuffStacks("Festering Wound") === 6),
      Spell.cast("Outbreak", () => (this.getDebuffRemainingTime("Virulent Plague") === 0 || this.hasTalent("Morbidity") && !me.hasAura(auras.gift_of_the_sanlayn) && this.hasTalent("Superstrain") && this.getDebuffRemainingTime("Frost Fever") === 0 && this.getDebuffRemainingTime("Blood Plague") === 0) && (!this.hasTalent("Unholy Blight") || this.hasTalent("Unholy Blight") && Spell.getCooldown("Dark Transformation").timeleft > 15) && (!this.hasTalent("Raise Abomination") || this.hasTalent("Raise Abomination") && Spell.getCooldown("Raise Abomination").timeleft > 15)),
      Spell.cast("Apocalypse", () => Settings.UseApocalypse && this.getEnemyCount() > 1 && me.getReadyRunes() <= 3),
      Spell.cast("Abomination Limb", () => this.getEnemyCount() > 1),
      // AoE Burst Rotation
      Spell.cast("Festering Strike", () => me.hasAura(auras.festering_scythe)),
      Spell.cast("Death Coil", () => !me.hasAura(auras.vampiric_strike) && this.getEnemyCount() < this.epidemicTargets() && (!this.hasTalent("Bursting Sores") || this.hasTalent("Bursting Sores") && this.getWoundedTargets() < this.getEnemyCount() && this.getWoundedTargets() < this.getEnemyCount() * 0.4 && me.hasAura(auras.sudden_doom) || me.hasAura(auras.sudden_doom) && (me.hasAura(auras.a_feast_of_souls) || this.getDebuffRemainingTime("Death Rot") < 1.5 || this.getDebuffStacks("Death Rot") < 10))),
      Spell.cast("Epidemic", () => !me.hasAura(auras.vampiric_strike) && (!this.hasTalent("Bursting Sores") || this.hasTalent("Bursting Sores") && this.getWoundedTargets() < this.getEnemyCount() && this.getWoundedTargets() < this.getEnemyCount() * 0.4 && me.hasAura(auras.sudden_doom) || me.hasAura(auras.sudden_doom) && (me.hasAura(auras.a_feast_of_souls) || this.getDebuffRemainingTime("Death Rot") < 1.5 || this.getDebuffStacks("Death Rot") < 10))),
      Spell.cast("Scourge Strike", () => this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Scourge Strike", () => this.getDebuffStacks("Festering Wound") >= 1 || me.hasAura(auras.vampiric_strike)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && (this.getDebuffStacks("Festering Wound") >= 1 || me.hasAura(auras.vampiric_strike))),
      Spell.cast("Death Coil", () => this.getEnemyCount() < this.epidemicTargets()),
      Spell.cast("Epidemic"),
      Spell.cast("Festering Strike", () => this.getDebuffStacks("Festering Wound") <= 2),
      Spell.cast("Scourge Strike"),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows"))
    );
  }

  // AoE Burst
  aoeBurstAction() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      // AoE Cooldowns
      Spell.cast("Unholy Assault", () => this.getEnemyCount() > 1 && (Spell.getCooldown("Vile Contagion").timeleft < 3 || Spell.getCooldown("Vile Contagion").timeleft > 40 || !this.hasTalent("Vile Contagion"))),
      Spell.cast("Vile Contagion", () => this.getDebuffStacks("Festering Wound") >= 4 && (this.getAddTimeRemaining() > 4 || this.getAddTimeRemaining() <= 0 && this.getTargetTimeRemaining() > 4) && (this.getAddTimeRemaining() <= 11 || Spell.getCooldown("Death and Decay").timeleft < 3 || me.hasAura(auras.death_and_decay) && this.getDebuffStacks("Festering Wound") >= 4) || this.getEnemyCount() > 1 && this.getDebuffStacks("Festering Wound") === 6),
      Spell.cast("Dark Transformation", () => this.getEnemyCount() > 1 && (Spell.getCooldown("Vile Contagion").timeleft > 5 || !this.hasTalent("Vile Contagion") || me.hasAura(auras.death_and_decay) || Spell.getCooldown("Death and Decay").timeleft < 3)),
      Spell.cast("Outbreak", () => this.getDebuffTicksRemaining("Virulent Plague") < 5 && (this.getDebuffRemainingTime("Virulent Plague") === 0 || this.hasTalent("Morbidity") && !me.hasAura(auras.gift_of_the_sanlayn) && this.hasTalent("Superstrain") && this.getDebuffRemainingTime("Frost Fever") === 0 && this.getDebuffRemainingTime("Blood Plague") === 0) && (!this.hasTalent("Unholy Blight") || this.hasTalent("Unholy Blight") && Spell.getCooldown("Dark Transformation").timeleft > 0) && (!this.hasTalent("Raise Abomination") || this.hasTalent("Raise Abomination") && Spell.getCooldown("Raise Abomination").timeleft > 0)),
      Spell.cast("Apocalypse", () => Settings.UseApocalypse && this.getEnemyCount() > 1 && me.getReadyRunes() <= 3),
      Spell.cast("Abomination Limb", () => this.getEnemyCount() > 1),
      // AoE Burst Rotation
      Spell.cast("Death and Decay", () => !me.hasAura(auras.death_and_decay) && (!this.hasTalent("Bursting Sores") && !this.hasTalent("Vile Contagion") || this.getWoundedTargets() >= this.getEnemyCount() || this.getWoundedTargets() >= 8 || this.getAddTimeRemaining() <= 11 && this.getAddTimeRemaining() > 5 || !me.hasAura(auras.death_and_decay) && this.hasTalent("Defile"))),
      Spell.cast("Defile", () => this.hasTalent("Defile") && !me.hasAura(auras.death_and_decay) && (!this.hasTalent("Bursting Sores") && !this.hasTalent("Vile Contagion") || this.getWoundedTargets() >= this.getEnemyCount() || this.getWoundedTargets() >= 8 || this.getAddTimeRemaining() <= 11 && this.getAddTimeRemaining() > 5)),
      Spell.cast("Scourge Strike", () => this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Festering Strike", () => !this.hasTalent("Vile Contagion")),
      Spell.cast("Festering Strike", () => Spell.getCooldown("Vile Contagion").timeleft < 5 || this.getWoundedTargets() >= this.getEnemyCount() && this.getDebuffStacks("Festering Wound") <= 4),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && me.hasAura(auras.sudden_doom) && this.getEnemyCount() < this.epidemicTargets()),
      Spell.cast("Epidemic", () => !this.variablePoolingRunicPower && me.hasAura(auras.sudden_doom)),
      Spell.cast("Festering Strike", () => Spell.getCooldown("Apocalypse").timeleft < 1.5 && this.getDebuffStacks("Festering Wound") === 0 || this.getWoundedTargets() < this.getEnemyCount()),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && this.getEnemyCount() < this.epidemicTargets()),
      Spell.cast("Epidemic", () => !this.variablePoolingRunicPower)
    );
  }

  // Cleave Action List (2 targets) with San'layn
  cleaveActionSan() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      // Cooldowns
      Spell.cast("Dark Transformation", () => me.hasAura(auras.death_and_decay) && (this.hasTalent("Apocalypse") && me.hasPet() || !this.hasTalent("Apocalypse")) || this.getTargetTimeRemaining() < 20 || this.getAddTimeRemaining() < 20),
      Spell.cast("Unholy Assault", () => me.hasAura(auras.dark_transformation) && this.getAuraRemainingTime("Dark Transformation") < 12 || this.getTargetTimeRemaining() < 20 || this.getAddTimeRemaining() < 20),
      Spell.cast("Apocalypse", () => Settings.UseApocalypse),
      Spell.cast("Outbreak", () => (this.getDebuffRemainingTime("Virulent Plague") === 0 || this.hasTalent("Morbidity") && me.hasAura(auras.infliction_of_sorrow) && this.hasTalent("Superstrain") && this.getDebuffRemainingTime("Frost Fever") === 0 && this.getDebuffRemainingTime("Blood Plague") === 0) && (!this.hasTalent("Unholy Blight") || this.hasTalent("Unholy Blight") && Spell.getCooldown("Dark Transformation").timeleft > 5) && (!this.hasTalent("Raise Abomination") || this.hasTalent("Raise Abomination") && Spell.getCooldown("Raise Abomination").timeleft > 5)),
      Spell.cast("Abomination Limb", () => !me.hasAura(auras.gift_of_the_sanlayn) && !me.hasAura(auras.sudden_doom) && me.hasAura(auras.festermight) && this.getDebuffStacks("Festering Wound") <= 2 || !me.hasAura(auras.gift_of_the_sanlayn) && this.getTargetTimeRemaining() < 12),
      // Rotation
      Spell.cast("Death and Decay", () => !me.hasAura(auras.death_and_decay) && (Spell.getCooldown("Apocalypse").timeleft > 0 || !this.hasTalent("Apocalypse"))),
      Spell.cast("Defile", () => this.hasTalent("Defile") && !me.hasAura(auras.death_and_decay) && (Spell.getCooldown("Apocalypse").timeleft > 0 || !this.hasTalent("Apocalypse"))),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && this.hasTalent("Improved Death Coil")),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.vampiric_strike)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && me.hasAura(auras.vampiric_strike)),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && !this.hasTalent("Improved Death Coil")),
      Spell.cast("Festering Strike", () => !me.hasAura(auras.vampiric_strike) && !this.variablePopWounds && this.getDebuffStacks("Festering Wound") < 2 || me.hasAura(auras.festering_scythe)),
      Spell.cast("Festering Strike", () => !me.hasAura(auras.vampiric_strike) && Spell.getCooldown("Apocalypse").timeleft < this.variableApocTiming && this.getDebuffStacks("Festering Wound") < 1),
      Spell.cast("Scourge Strike", () => this.variablePopWounds),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.variablePopWounds)
    );
  }

  // Cleave Action List (2 targets)
  cleaveAction() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      // Rotation
      Spell.cast("Death and Decay", () => !me.hasAura(auras.death_and_decay) && (Spell.getCooldown("Apocalypse").timeleft > 0 || !this.hasTalent("Apocalypse"))),
      Spell.cast("Defile", () => this.hasTalent("Defile") && !me.hasAura(auras.death_and_decay) && (Spell.getCooldown("Apocalypse").timeleft > 0 || !this.hasTalent("Apocalypse"))),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && this.hasTalent("Improved Death Coil")),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.vampiric_strike)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && me.hasAura(auras.vampiric_strike)),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && !this.hasTalent("Improved Death Coil")),
      Spell.cast("Festering Strike", () => !me.hasAura(auras.vampiric_strike) && !this.variablePopWounds && this.getDebuffStacks("Festering Wound") < 2 || me.hasAura(auras.festering_scythe)),
      Spell.cast("Festering Strike", () => !me.hasAura(auras.vampiric_strike) && Spell.getCooldown("Apocalypse").timeleft < this.variableApocTiming && this.getDebuffStacks("Festering Wound") < 1),
      Spell.cast("Scourge Strike", () => this.variablePopWounds),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.variablePopWounds)
    );
  }

  // San'layn Single Target Fishing
  sanFishingAction() {
    return new bt.Selector(
      Spell.cast("Anti-Magic Shell", () => me.powerByType(PowerType.RunicPower) < 40),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.infliction_of_sorrow)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && me.hasAura(auras.infliction_of_sorrow)),
      Spell.cast("Death and Decay", () => !me.hasAura(auras.death_and_decay) && !me.hasAura(auras.vampiric_strike)),
      Spell.cast("Defile", () => this.hasTalent("Defile") && !me.hasAura(auras.death_and_decay) && !me.hasAura(auras.vampiric_strike)),
      Spell.cast("Death Coil", () => me.hasAura(auras.sudden_doom) && this.hasTalent("Doomed Bidding") || this.hasTalent("Frenzied Bloodthirst") && me.getAuraStacks("Essence of the Blood Queen") >= me.maxStacks("Essence of the Blood Queen") && !me.hasAura(auras.vampiric_strike)),
      Spell.cast("Soul Reaper", () => this.getCurrentTarget().pctHealth <= 35 && this.getTargetTimeRemaining() > 5),
      Spell.cast("Death Coil", () => !me.hasAura(auras.vampiric_strike)),
      Spell.cast("Scourge Strike", () => (this.getDebuffStacks("Festering Wound") >= 3-(me.hasPet() && this.hasTalent("Abomination") ? 1 : 0) && Spell.getCooldown("Apocalypse").timeleft > this.variableApocTiming) || me.hasAura(auras.vampiric_strike)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && ((this.getDebuffStacks("Festering Wound") >= 3-(me.hasPet() && this.hasTalent("Abomination") ? 1 : 0) && Spell.getCooldown("Apocalypse").timeleft > this.variableApocTiming) || me.hasAura(auras.vampiric_strike))),
      Spell.cast("Festering Strike", () => this.getDebuffStacks("Festering Wound") < 3-(me.hasPet() && this.hasTalent("Abomination") ? 1 : 0))
    );
  }

  // Single Target San'layn
  singleTargetSanAction() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      this.cdsSingleTargetSan(),
      // Rotation
      Spell.cast("Death and Decay", () => !me.hasAura(auras.death_and_decay) && this.hasTalent("Unholy Ground") && Spell.getCooldown("Dark Transformation").timeleft < 5),
      Spell.cast("Defile", () => this.hasTalent("Defile") && !me.hasAura(auras.death_and_decay) && this.hasTalent("Unholy Ground") && Spell.getCooldown("Dark Transformation").timeleft < 5),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.infliction_of_sorrow)),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && me.hasAura(auras.infliction_of_sorrow)),
      Spell.cast("Death Coil", () => me.hasAura(auras.sudden_doom) && me.hasAura(auras.gift_of_the_sanlayn) && (this.hasTalent("Doomed Bidding") || this.hasTalent("Rotten Touch")) || me.getReadyRunes() < 3 && !me.hasAura(auras.runic_corruption) || me.powerByType(PowerType.RunicPower) > 80 || me.hasAura(auras.gift_of_the_sanlayn) && me.getAuraStacks("Essence of the Blood Queen") >= me.maxStacks("Essence of the Blood Queen") && this.hasTalent("Frenzied Bloodthirst") && me.getAuraRemainingTime("Essence of the Blood Queen") > 3),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.gift_of_the_sanlayn) && me.hasAura(auras.vampiric_strike) || this.hasTalent("Gift of the San'layn") && me.hasAura(auras.dark_transformation) && me.getAuraRemainingTime("Dark Transformation") < 1.5),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && (me.hasAura(auras.gift_of_the_sanlayn) && me.hasAura(auras.vampiric_strike) || this.hasTalent("Gift of the San'layn") && me.hasAura(auras.dark_transformation) && me.getAuraRemainingTime("Dark Transformation") < 1.5)),
      Spell.cast("Soul Reaper", () => this.getCurrentTarget().pctHealth <= 35 && !me.hasAura(auras.gift_of_the_sanlayn) && this.getTargetTimeRemaining() > 5),
      Spell.cast("Scourge Strike", () => me.hasAura(auras.vampiric_strike) && this.getDebuffStacks("Festering Wound") >= 1),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && me.hasAura(auras.vampiric_strike) && this.getDebuffStacks("Festering Wound") >= 1),
      Spell.cast("Festering Strike", () => (this.getDebuffStacks("Festering Wound") === 0 && Spell.getCooldown("Apocalypse").timeleft < this.variableApocTiming) || (this.hasTalent("Gift of the San'layn") && !me.hasAura(auras.gift_of_the_sanlayn) || !this.hasTalent("Gift of the San'layn")) && (me.hasAura(auras.festering_scythe) || this.getDebuffStacks("Festering Wound") <= 1)),
      Spell.cast("Scourge Strike", () => (!this.hasTalent("Apocalypse") || Spell.getCooldown("Apocalypse").timeleft > this.variableApocTiming) && (this.getDebuffStacks("Festering Wound") >= 3-(me.hasPet() && this.hasTalent("Abomination") ? 1 : 0) || me.hasAura(auras.vampiric_strike))),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && (!this.hasTalent("Apocalypse") || Spell.getCooldown("Apocalypse").timeleft > this.variableApocTiming) && (this.getDebuffStacks("Festering Wound") >= 3-(me.hasPet() && this.hasTalent("Abomination") ? 1 : 0) || me.hasAura(auras.vampiric_strike))),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && this.getDebuffRemainingTime("Death Rot") < 1.5 || (me.hasAura(auras.sudden_doom) && this.getDebuffStacks("Festering Wound") >= 1 || me.getReadyRunes() < 2)),
      Spell.cast("Scourge Strike", () => this.getDebuffStacks("Festering Wound") > 4),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.getDebuffStacks("Festering Wound") > 4),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower)
    );
  }

  // Single Target
  singleTargetAction() {
    return new bt.Selector(
      this.useTrinkets(),
      this.useRacials(),
      this.sharedCooldowns(),
      this.cdsSingleTarget(),
      // Rotation
      Spell.cast("Soul Reaper", () => this.getCurrentTarget().pctHealth <= 35 && this.getTargetTimeRemaining() > 5),
      Spell.cast("Scourge Strike", () => this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.getCurrentTarget().hasAuraByMe("Chains of Ice") && this.getCurrentTarget().hasAura("Chains of Ice Trollbane Slow")),
      Spell.cast("Death and Decay", () => this.hasTalent("Unholy Ground") && !me.hasAura(auras.death_and_decay) && (me.hasPet() || this.hasTalent("Raise Abomination") && me.hasPet() || me.pet && me.pet.active)),
      Spell.cast("Defile", () => this.hasTalent("Defile") && this.hasTalent("Unholy Ground") && !me.hasAura(auras.death_and_decay) && (me.hasPet() || this.hasTalent("Raise Abomination") && me.hasPet() || me.pet && me.pet.active)),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower && this.variableSpendRp() || this.getTargetTimeRemaining() < 10),
      Spell.cast("Festering Strike", () => this.getDebuffStacks("Festering Wound") < 4 && (!this.variablePopWounds || me.hasAura(auras.festering_scythe))),
      Spell.cast("Scourge Strike", () => this.variablePopWounds),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && this.variablePopWounds),
      Spell.cast("Death Coil", () => !this.variablePoolingRunicPower),
      Spell.cast("Scourge Strike", () => !this.variablePopWounds && this.getDebuffStacks("Festering Wound") >= 4),
      Spell.cast("Clawing Shadows", () => this.hasTalent("Clawing Shadows") && !this.variablePopWounds && this.getDebuffStacks("Festering Wound") >= 4)
    );
  }

  // Helper methods
  getCurrentTarget() {
    const target = me.target;
    if (target && !target.deadOrGhost && me.canAttack(target)) {
      return target;
    }
    return combat.bestTarget;
  }

  getEnemyCount() {
    return me.getUnitsAroundCount(8);
  }

  shouldUseOffensiveCDs() {
    const target = this.getCurrentTarget();
    return target && target.timeToDeath() > 15;
  }

  getDebuffStacks(debuffName) {
    const target = this.getCurrentTarget();
    return target ? target.getAuraStacks(debuffName) || 0 : 0;
  }

  getDebuffRemainingTime(debuffName) {
    const target = this.getCurrentTarget();
    const aura = target ? target.getAura(debuffName) : null;
    return aura ? aura.remaining / 1000 : 0;
  }

  getDebuffTicksRemaining(debuffName) {
    const debuffTime = this.getDebuffRemainingTime(debuffName);
    return Math.floor(debuffTime / 3); // Most DoTs tick every 3 seconds
  }

  getAuraRemainingTime(auraName) {
    const aura = me.getAura(auraName);
    return aura ? aura.remaining / 1000 : 0;
  }

  getTargetTimeRemaining() {
    const target = this.getCurrentTarget();
    return target ? target.timeToDeath() || 100 : 100;
  }

  getAddTimeRemaining() {
    // For raid events in SimC - estimating 0 here in regular world
    return 0;
  }

  getWoundedTargets() {
    // Approximate the number of enemies with Festering Wounds
    let count = 0;
    const enemies = me.getUnitsAround(8);
    for (const unit of enemies) {
      if (unit.getAura("Festering Wound")) {
        count++;
      }
    }
    return count;
  }

  hasTalent(talentName) {
    // For Hero Talent San'layn, check for Vampiric Strike
    if (talentName === "Vampiric Strike") {
      return me.hasAura(auras.vampiric_strike); // Using the key talent from HeroTalents.txt
    }
    
    // For San'layn tree detection
    if (talentName === "Gift of the San'layn") {
      return me.hasAura(auras.vampiric_strike); // If they have Vampiric Strike, assume they have San'layn tree
    }
    
    return Spell.isSpellKnown(talentName);
  }

  epidemicTargets() {
    // Calculate the threshold for switching to Epidemic
    const sanCoilMult = me.getAuraStacks("Essence of the Blood Queen") >= 4 ? 2 : 1;
    return 3 + (this.hasTalent("Improved Death Coil") ? 1 : 0) + 
           (this.hasTalent("Frenzied Bloodthirst") ? sanCoilMult : 0) + 
           (this.hasTalent("Hungering Thirst") && this.hasTalent("Harbinger of Doom") && me.hasAura(auras.sudden_doom) ? 1 : 0);
  }

  variableSpendRp() {
    return (!this.hasTalent("Rotten Touch") || (this.hasTalent("Rotten Touch") && !this.getCurrentTarget().hasAuraByMe("Rotten Touch")) || me.powerByType(PowerType.RunicPower) > (me.maxPowerByType(PowerType.RunicPower) - 20)) && 
           ((this.hasTalent("Improved Death Coil") && (this.getEnemyCount() === 2 || this.hasTalent("Coil of Devastation")) || 
           me.getReadyRunes() < 3 || me.pet && (me.pet.isGargoyle && me.pet.active) || me.hasAura(auras.sudden_doom) || 
           !this.variablePopWounds && this.getDebuffStacks("Festering Wound") >= 4));
  }
}