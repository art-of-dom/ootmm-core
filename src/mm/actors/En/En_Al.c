#include <combo.h>

int EnAl_GiveItem(Actor* this, GameState_Play* play, s16 gi, float a, float b)
{
    switch (gi)
    {
    case GI_MM_MASK_KAFEI:
        gi = comboOverride(OV_NPC, 0, NPC_MM_MASK_KAFEI, gi);
        gMmExtraFlags2.maskKafei = 1;
        break;
    }
    return GiveItem(this, play, gi, a, b);
}
