// ---------------------------------------------------------------------------
// Subscription plans (tier list). Prices in Toman per month.
// The AI model itself is configured later by the owner (admin panel provider);
// each tier only declares what that tier is entitled to.
// ---------------------------------------------------------------------------

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  /** Max connected Instagram pages. */
  pages: number;
  /** Auto replies per day per page. */
  dailyReplies: number;
  /** Replies per hour per DM conversation. */
  hourlyReplies: number;
  /** Max Q&A training pairs. */
  qaItems: number;
  /** Max knowledge-base items. */
  knowledgeItems: number;
  /** Marketing label for the AI capability of this tier. */
  aiTier: string;
  support: string;
  features: string[];
  popular?: boolean;
}

export const PLANS: Plan[] = [
  {
    id: 'starter',
    name: 'استارت',
    tagline: 'شروع ساخت دستیار فروش',
    monthlyPrice: 999_000,
    pages: 1,
    dailyReplies: 200,
    hourlyReplies: 20,
    qaItems: 20,
    knowledgeItems: 30,
    aiTier: 'موتور پاسخ پایه',
    support: 'پشتیبانی ایمیلی',
    features: [
      '۱ پیج اینستاگرام',
      '۲۰۰ پاسخ هوشمند در روز',
      '۲۰ پرسش‌وپاسخ آموزش دستیار',
      '۳۰ آیتم دانش',
      'گزارش مصرف ماهانه'
    ]
  },
  {
    id: 'pro',
    name: 'حرفه‌ای',
    tagline: 'برای پیج‌های فعال فروش',
    monthlyPrice: 1_990_000,
    pages: 1,
    dailyReplies: 600,
    hourlyReplies: 40,
    qaItems: 60,
    knowledgeItems: 80,
    aiTier: 'موتور پاسخ استاندارد',
    support: 'پشتیبانی چت در ساعات کاری',
    features: [
      '۱ پیج اینستاگرام',
      '۶۰۰ پاسخ هوشمند در روز',
      '۶۰ پرسش‌وپاسخ آموزش دستیار',
      '۸۰ آیتم دانش',
      'دروازهٔ موضوع سخت‌گیرانه',
      'گزارش مصرف هفتگی'
    ],
    popular: true
  },
  {
    id: 'business',
    name: 'بیزینس',
    tagline: '۱۰ برابر ظرفیت استارت',
    monthlyPrice: 2_900_000,
    pages: 2,
    dailyReplies: 2_000,
    hourlyReplies: 40,
    qaItems: 120,
    knowledgeItems: 150,
    aiTier: 'موتور پاسخ پیشرفته',
    support: 'پشتیبانی چت + آنبوردینگ',
    features: [
      '۲ پیج اینستاگرام',
      '۲٬۰۰۰ پاسخ هوشمند در روز',
      '۱۲۰ پرسش‌وپاسخ آموزش دستیار',
      '۱۵۰ آیتم دانش',
      'شخصیت‌بندی کامل دستیار',
      'گزارش مصرف هفتگی + تحلیل اینباکس'
    ]
  },
  {
    id: 'advanced',
    name: 'پیشرفته',
    tagline: 'چندپیج و گردش کار سنگین',
    monthlyPrice: 4_900_000,
    pages: 5,
    dailyReplies: 5_000,
    hourlyReplies: 60,
    qaItems: 250,
    knowledgeItems: 300,
    aiTier: 'موتور پاسخ پیشرفته + دروازهٔ موضوع اختصاصی',
    support: 'پشتیبانی اولویت‌دار',
    features: [
      '۵ پیج اینستاگرام',
      '۵٬۰۰۰ پاسخ هوشمند در روز',
      '۲۵۰ پرسش‌وپاسخ آموزش دستیار',
      '۳۰۰ آیتم دانش',
      'قوانین محافظت سفارشی',
      'گزارش روزانه'
    ]
  },
  {
    id: 'enterprise',
    name: 'سازمانی',
    tagline: 'بالاترین سقف، با مدل اختصاصی',
    monthlyPrice: 9_000_000,
    pages: 20,
    dailyReplies: 20_000,
    hourlyReplies: 80,
    qaItems: 500,
    knowledgeItems: 600,
    aiTier: 'مدل اختصاصی (بعداً وصل می‌شود)',
    support: 'پشتیبانی اختصاصی + SLA',
    features: [
      '۲۰ پیج اینستاگرام',
      '۲۰٬۰۰۰ پاسخ هوشمند در روز',
      '۵۰۰ پرسش‌وپاسخ آموزش دستیار',
      '۶۰۰ آیتم دانش',
      'مدل هوش مصنوعی اختصاصی',
      'تیم موفقیت اختصاصی'
    ]
  }
];

export function planById(id: string | null | undefined): Plan | null {
  if (!id) return null;
  return PLANS.find(p => p.id === id) ?? null;
}
