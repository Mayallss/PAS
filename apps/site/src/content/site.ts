/**
 * Public website content, carried over from the legacy pas-frontweb pages (TH + EN).
 * Every text is { th, en } so the two languages cannot drift apart structurally.
 * Obvious typos in the legacy Thai copy were corrected; wording is otherwise unchanged.
 */

export const LOCALES = ['th', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type T = { th: string; en: string };

export function isLocale(v: string): v is Locale {
  return (LOCALES as readonly string[]).includes(v);
}

export const FOUNDED = 1996;

export const company = {
  short: 'PAS',
  name: { th: 'บริษัท โพรเฟสชั่นแนล แอคเคาน์ติ้ง เซอร์วิส จำกัด', en: 'Professional Accounting Service Co.,Ltd.' },
  brand: { th: 'โพรเฟสชั่นแนล แอคเคาน์ติ้ง เซอร์วิส', en: 'Professional Accounting Service' },
  address: {
    th: 'เลขที่ 60 หมู่ 2 ต.หนองป่าครั่ง อ.เมืองเชียงใหม่ จ.เชียงใหม่ 50000',
    en: '60 Moo 2, Nong Pa Khrang Subdistrict, Mueang Chiang Mai District, Chiang Mai 50000, Thailand',
  },
  email: 'info@pas-acc.com',
  phone: '+66 5 324 1979',
  phoneTel: '+6653241979',
  phoneLocal: '053-241979',
  hours: {
    weekdays: { th: 'จันทร์ – ศุกร์', en: 'Monday – Friday' },
    weekdayTime: { th: '8.00 – 18.00 น.', en: '8 AM – 6 PM' },
    weekend: { th: 'เสาร์ – อาทิตย์', en: 'Saturday – Sunday' },
    closed: { th: 'หยุดทำการ', en: 'Closed' },
  },
  line: { name: 'PAS-สำนักงานบัญชี', url: 'https://lin.ee/xS8J5Eq' },
  facebook: 'https://www.facebook.com/pas.acc/',
  tiktok: { handle: '@professionalaccounting', url: 'https://www.tiktok.com/@professionalaccounting' },
  linkedin: 'https://th.linkedin.com/company/professional-accounting-service',
  coachBeaver: 'https://www.facebook.com/CoachBeaverbyPAS',
  /** Legacy "ขอใบเสนอราคา" and "ลงทะเบียนอบรม" both point to this Google Form. */
  requestForm: 'https://docs.google.com/forms/d/e/1FAIpQLSeGqj2i7wzAU2DYjSRDLqAiXbqqSBso1JM22v-hukyRmRj12w/viewform',
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3777.2725237532695!2d99.03078611470973!3d18.786004465905783!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x30da255dc7b30df9%3A0x64a65c362de53e69!2sProfessional%20Accounting%20Services%20Co.%2CLtd.!5e0!3m2!1sth!2sth!4v1619417499852!5m2!1sth!2sth',
  mapLink: 'https://www.google.com/maps?cid=7252585637694750313',
};

export const nav = [
  { href: '', label: { th: 'หน้าหลัก', en: 'Home' } },
  { href: '/about', label: { th: 'เกี่ยวกับเรา', en: 'About us' } },
  { href: '/#services', label: { th: 'บริการของเรา', en: 'Services' } },
  { href: '/testimonials', label: { th: 'เสียงจากลูกค้า', en: 'Testimonials' } },
  { href: '/contact', label: { th: 'ติดต่อเรา', en: 'Contact' } },
] as const;

export const ui = {
  requestQuote: { th: 'ขอใบเสนอราคา', en: 'Request a quote' },
  registerTraining: { th: 'ลงทะเบียนอบรม', en: 'Register for training' },
  contactNow: { th: 'ติดต่อเราตอนนี้', en: 'Contact us now' },
  ourServices: { th: 'ดูบริการของเรา', en: 'Our services' },
  readMore: { th: 'อ่านเพิ่มเติม', en: 'Read more' },
  allTestimonials: { th: 'อ่านเสียงจากลูกค้าทั้งหมด', en: 'Read all testimonials' },
  meetTeam: { th: 'พบกับทีมของเรา', en: 'Meet our team' },
  menu: { th: 'เมนู', en: 'Menu' },
  close: { th: 'ปิด', en: 'Close' },
  switchLang: { th: 'English', en: 'ภาษาไทย' },
  skip: { th: 'ข้ามไปยังเนื้อหา', en: 'Skip to content' },
  copyright: { th: 'สงวนลิขสิทธิ์', en: 'All rights reserved' },
  showMap: { th: 'แสดงแผนที่', en: 'Show map' },
  mapNote: {
    th: 'แผนที่โหลดจาก Google Maps เมื่อคุณกดปุ่มเท่านั้น',
    en: 'The map is loaded from Google Maps only after you click.',
  },
  openInMaps: { th: 'เปิดใน Google Maps', en: 'Open in Google Maps' },
  experience: { th: 'ประสบการณ์การทำงานที่ผ่านมา', en: 'Past experience' },
  yoe: { th: 'ปีประสบการณ์', en: 'YOE' },
  certifiedBy: { th: 'ได้รับการรับรองจาก', en: 'Fully accredited' },
  followUs: { th: 'ติดตามเรา', en: 'Follow us' },
  training: { th: 'อบรมและสัมมนา', en: 'Training' },
};

export const home = {
  eyebrow: { th: 'สำนักงานบัญชี เชียงใหม่ ตั้งแต่ปี 2539', en: 'Chiang Mai accounting firm since 1996' },
  title: {
    th: 'สำนักงานบัญชี เชียงใหม่ และที่ปรึกษาที่น่าไว้วางใจสำหรับธุรกิจคุณ',
    en: 'Trusted Chiang Mai Accounting and Consulting for Your Business',
  },
  lead: {
    th: 'บริการให้คำปรึกษาด้านบัญชีและธุรกิจชั้นนำ เพื่อให้ชีวิตและธุรกิจของคุณในประเทศไทยง่ายขึ้น!',
    en: 'Industry leading accounting and consulting services to make your life and business in Thailand easier!',
  },
  bullets: [
    { th: 'การเปิดธุรกิจใหม่ในประเทศไทย', en: 'Opening a new business in Thailand?' },
    { th: 'บริการจัดทำและตรวจสอบบัญชีที่เหมาะสม', en: 'Need proper bookkeeping and auditing services?' },
    { th: 'ต้องการปรับปรุงประสิทธิภาพการทำงานภายใน', en: 'Need to improve your internal work efficiency?' },
    { th: 'เหมาะสำหรับชาวไทยและชาวต่างชาติ', en: 'Suitable for Thai nationals and foreign expats' },
  ],
  helpTitle: {
    th: 'ต้องการความช่วยเหลือด้านบัญชี การเงิน หรือธุรกิจในประเทศไทยหรือไม่?',
    en: 'Need help with your accounting, financials or business in Thailand?',
  },
  help: [
    {
      th: 'หากคุณดำเนินธุรกิจในประเทศไทย จำเป็นอย่างยิ่งที่จะต้องมีพันธมิตรที่เชื่อถือได้และมีประสบการณ์ที่คุณสามารถไว้วางใจได้ มิฉะนั้นคุณอาจพบว่าตัวเองมีปัญหาทางการเงินหรือทางกฎหมายได้อย่างรวดเร็ว!',
      en: 'If you’re running a business in Thailand, it’s essential to have a trusted, experienced partner you can rely on. Otherwise, you can quickly find yourself in a financial or legal mess!',
    },
    {
      th: 'เราสนับสนุนลูกค้าด้วยความรู้ ประสบการณ์ และความเชี่ยวชาญของเรา ในฐานะผู้นำด้านการให้คำปรึกษาด้านบัญชีและธุรกิจในภาคเหนือ เป้าหมายของเราคือทำให้ธุรกิจ (และชีวิต) ของคุณง่ายขึ้น!',
      en: 'We support our clients with our vast knowledge, experience and expertise. As a leader in accounting and business consulting for the northern region, our goal is to make your business (and life) easier!',
    },
  ],
  whyTitle: { th: 'ทำไมต้องเลือก PAS?', en: 'Why choose Professional Accounting Service?' },
  whyLead: {
    th: 'เราได้รับการรับรองคุณภาพและมีประสบการณ์สูง นี่คือสิ่งที่ทำให้เราพิเศษ',
    en: 'We’re fully accredited, qualified and highly experienced – here’s what makes us extra special!',
  },
  md: { name: { th: 'นายกรวิชญ์ คาร์นิยอร์', en: 'Mr. Koravich Kharnijor' }, role: { th: 'กรรมการผู้จัดการ', en: 'Managing Director' } },
  values: [
    {
      title: { th: 'ความมุ่งมั่น', en: 'Commitment' },
      quote: {
        th: 'ความมุ่งมั่นของเราคือพื้นฐานสู่ผลงานที่เรามอบให้ลูกค้าเสมอมา เรามั่นใจว่าบริการของเราจะเป็นไปตามที่คาดหวังไว้',
        en: 'Our commitment is fundamental and striving for excellence, we ensure that our products and services consistently exceed expectations.',
      },
    },
    {
      title: { th: 'ที่ปรึกษา', en: 'Consult' },
      quote: {
        th: 'เราเน้นการทำงานด้านบัญชีและแก้ไขปัญหาเพื่อตอบโจทย์ธุรกิจของคุณ',
        en: 'We focus on your accounting and your business solutions.',
      },
    },
    {
      title: { th: 'ลูกค้า', en: 'Customer' },
      quote: {
        th: 'ความพึงพอใจของลูกค้าคือหัวใจสำคัญของธุรกิจเรา เราให้ความสำคัญกับการทำความเข้าใจและตอบสนองความต้องการ เพื่อให้มั่นใจว่าจะได้รับประสบการณ์ที่ดีเยี่ยม',
        en: 'Customer satisfaction is a core aspect of our business, we prioritize understanding and addressing the needs to ensure a superior experience.',
      },
    },
  ],
  servicesTitle: { th: 'บริการของเรา', en: 'Our services' },
  servicesLead: {
    th: 'ครบทุกงานบัญชี ภาษี และที่ปรึกษาธุรกิจ ในที่เดียว',
    en: 'Accounting, tax and business consulting — all in one place.',
  },
  clientsTitle: { th: 'ให้บริการลูกค้ามากกว่า 150 ราย ตลอด {years} ปีในประเทศไทย', en: 'Serving 150+ clients over {years} years in Thailand' },
  testimonialsTitle: { th: 'เสียงจากลูกค้า', en: 'Customer testimonials' },
  officeTitle: { th: 'สำนักงานบัญชีและที่ปรึกษามืออาชีพใน จ.เชียงใหม่', en: 'Looking for a professional accounting and consulting service in Chiang Mai?' },
  office: {
    th: 'สำนักงานของเราตั้งอยู่ในภาคเหนือของประเทศไทย มีนักบัญชีและที่ปรึกษามืออาชีพกว่า 30 คน ที่ให้บริการลูกค้าทั้งแบบตัวต่อตัวและทางออนไลน์',
    en: 'Our office in Northern Thailand has over 30 professional accountants and consultants who serve clients both in-person and online.',
  },
  remote: {
    th: 'นอกจากนี้เรายังสามารถดูแลคุณได้อย่างเต็มที่ทางอีเมลหรือโทรศัพท์',
    en: 'We’re also able to fully support you virtually, via email or phone.',
  },
  certTitle: { th: 'ได้รับการรับรองจาก', en: 'Fully accredited and certified to help you' },
  askTitle: { th: 'ถามคำถามกับนักบัญชีและที่ปรึกษาของเรา', en: 'Ask our accountants and consultants a question' },
  askLead: { th: 'มีคำถาม? เรามีคำตอบ! รับคำแนะนำฟรี', en: 'Got questions? We’ve got answers! Ask a question and get free advice.' },
  lineScan: { th: 'สแกนเพื่อเพิ่มเพื่อนใน LINE', en: 'Scan to add us on LINE' },
};

export function stats(): { value: number; suffix: string; label: T }[] {
  return [
    { value: yearsSinceFounded(), suffix: '', label: { th: 'ปีแห่งประสบการณ์', en: 'Years of experience' } },
    { value: 150, suffix: '+', label: { th: 'ลูกค้าที่ไว้วางใจ', en: 'Clients served' } },
    { value: 30, suffix: '+', label: { th: 'นักบัญชีและที่ปรึกษา', en: 'Accountants & consultants' } },
    { value: 9001, suffix: '', label: { th: 'มาตรฐาน ISO 9001:2015', en: 'ISO 9001:2015 certified' } },
  ];
}

export type ServiceIcon = 'book' | 'search' | 'shield' | 'wallet' | 'chart' | 'users' | 'passport' | 'cloud';

export const services: { icon: ServiceIcon; title: T; desc: T }[] = [
  {
    icon: 'book',
    title: { th: 'ระบบบัญชีและการทำบัญชี', en: 'Accounting & Bookkeeping' },
    desc: { th: 'บริการทำบัญชีที่ยืดหยุ่น ปรับให้เหมาะกับธุรกิจของคุณ', en: 'Flexible bookkeeping services tailored to your business' },
  },
  {
    icon: 'search',
    title: { th: 'บริการตรวจสอบบัญชี', en: 'Auditing Service' },
    desc: { th: 'ตรวจสอบบัญชีโดยผู้เชี่ยวชาญมืออาชีพอย่างมีประสิทธิภาพ', en: 'Professional auditing for statutory or regulatory reasons' },
  },
  {
    icon: 'shield',
    title: { th: 'ควบคุมภายในและการทุจริต', en: 'Internal Control & Fraud Litigation' },
    desc: { th: 'เพิ่มความมั่นใจในการจัดการความเสี่ยงของระบบภายในและภาษี', en: 'Get reassurance that tax and internal risks are properly managed' },
  },
  {
    icon: 'wallet',
    title: { th: 'บัญชีเงินเดือนและบัญชีรายจ่าย', en: 'Payroll & Paymaster' },
    desc: { th: 'ดูแลเงินเดือนพนักงานและการคำนวณภาษี โดยข้อมูลทั้งหมดเป็นความลับ', en: 'Staff salary and tax calculations handled in absolute secrecy' },
  },
  {
    icon: 'chart',
    title: { th: 'ที่ปรึกษาด้านธุรกิจ', en: 'Business Consulting' },
    desc: { th: 'ส่งเสริมทักษะ ความสามารถ และประสิทธิภาพภายในองค์กร', en: 'Boost your organization’s internal performance and efficiency' },
  },
  {
    icon: 'users',
    title: { th: 'การจัดหาบุคลากรและการอบรม', en: 'Recruitment & Training' },
    desc: { th: 'ช่วยจัดหาบุคลากรที่เหมาะสมกับองค์กรของคุณและพัฒนาความสามารถ', en: 'Get help finding the most suitable candidates and improve their capabilities' },
  },
  {
    icon: 'passport',
    title: { th: 'งานทะเบียน VISA และใบอนุญาตทำงาน', en: 'Business Registration, Visa & Work Permit' },
    desc: { th: 'ช่วยวางระบบธุรกิจของคุณ รวมถึงการทำ VISA และใบอนุญาตทำงานให้เรียบร้อย', en: 'Get your business set up and your visa / work permit ready' },
  },
  {
    icon: 'cloud',
    title: { th: 'ระบบซอฟต์แวร์บัญชี', en: 'Accounting Software' },
    desc: { th: 'ดูแลธุรกิจของคุณด้วยระบบบัญชีบนคลาวด์', en: 'Cloud-based accounting applications for your business' },
  },
];

export const clients = [
  { src: '/img/clients/shell.webp', alt: 'Shell Thailand', w: 320, h: 303 },
  { src: '/img/clients/pt.webp', alt: 'PT', w: 225, h: 225 },
  { src: '/img/clients/skyview.webp', alt: 'Compass Skyview Hotel', w: 204, h: 203 },
  { src: '/img/clients/torhome.webp', alt: 'Tor Home', w: 360, h: 152 },
  { src: '/img/clients/cmuvf.webp', alt: 'CMUVF', w: 224, h: 224 },
  { src: '/img/clients/kenber.webp', alt: 'Kenber Geotechnic', w: 360, h: 137 },
  { src: '/img/clients/drchen.webp', alt: 'Dr. Chen Clinic', w: 360, h: 100 },
  { src: '/img/clients/tfd.webp', alt: 'Thai Freeze Dry', w: 400, h: 71 },
  { src: '/img/clients/amg.webp', alt: 'AMG Auto', w: 106, h: 50 },
  { src: '/img/clients/onsen.webp', alt: 'Onsen @ Moncham', w: 320, h: 241 },
  { src: '/img/clients/dusit.webp', alt: 'Dusit Princess Chiang Mai', w: 320, h: 320 },
  { src: '/img/clients/elephant.webp', alt: 'Elephant Nature Park', w: 200, h: 152 },
];

export const certifications = [
  { src: '/img/cert/dbd-quality.webp', alt: { th: 'สำนักงานบัญชีคุณภาพ กรมพัฒนาธุรกิจการค้า', en: 'DBD Certified Quality Accounting Practice' }, w: 400, h: 225 },
  { src: '/img/cert/iso9001.webp', alt: { th: 'ISO 9001:2015', en: 'ISO 9001:2015' }, w: 320, h: 320 },
  { src: '/img/cert/urs.webp', alt: { th: 'United Registrar of Systems ISO 9001', en: 'United Registrar of Systems ISO 9001' }, w: 320, h: 320 },
];

export const testimonials: { quote: T; name: string; role: string; photo: string; logo: string; logoAlt: string }[] = [
  {
    quote: {
      th: 'เราได้ร่วมงานกับ PAS มานานกว่า 20 ปี และถือว่าความสัมพันธ์ในการทำงานของเราเป็นพันธมิตรทางธุรกิจที่สำคัญ เต็มไปด้วยมิตรภาพและการสนับสนุนที่ดี ซึ่งพิสูจน์แล้วว่ามีคุณค่าและเป็นความสำเร็จที่สำคัญต่อธุรกิจของเรา',
      en: 'We have been working with PAS for over 20 years and could consider our working relationship as an important ‘Business Partner’, filled with great friendship and support which proved to be valuable and key success to our business.',
    },
    name: 'K. Kasit Phisitkul',
    role: 'Managing director of Kenber Geotechnic (Thailand) Co., Ltd.',
    photo: '/img/people/kasit.webp',
    logo: '/img/clients/kenber.webp',
    logoAlt: 'Kenber Geotechnic',
  },
  {
    quote: {
      th: 'ผมเชื่อมั่นใน PAS สำหรับที่ปรึกษาทางบัญชี พวกเขาได้ร่วมงานกับเราตั้งแต่รุ่นคุณพ่อคุณแม่ของผม และความสัมพันธ์ของพวกเราก็เติบโตขึ้นเรื่อยๆ ผมเชื่อมั่นในความเป็นมืออาชีพและความเป็นมิตรในการดูแลลูกค้า ผมยินดีมากที่ได้พบกับ PAS และยืนยันได้เลยว่าพวกเขาเป็นบริษัทบัญชีที่ดีที่สุดที่ผมไว้ใจครับ',
      en: 'I trusted PAS as our accounting consultant. They have been working with us since my parents and our relationship has grown as we believe in their professionalism and friendliness in taking care of their clients. I’m very pleased that I met with PAS and can confirm that they are the best accounting firm that I’m entrusted.',
    },
    name: 'K. Apirak Panya',
    role: 'Managing director of Tor kehaphan (2002) Co., Ltd.',
    photo: '/img/people/apirak.webp',
    logo: '/img/clients/torhome.webp',
    logoAlt: 'Tor Home',
  },
  {
    quote: {
      th: 'ผมรู้จัก PAS จากคุณพ่อคุณแม่ที่เคยทำงานร่วมกับพวกเขา ความประทับใจแรกคือพวกเขายอดเยี่ยมมากในงานด้านบัญชี และดูแลธุรกิจของเราอย่างดีมาโดยตลอด เมื่อผมเริ่มทำธุรกิจของตัวเอง ผมและภรรยาจึงเลือก PAS ให้ดูแลบัญชีของเรา ซึ่งพูดได้เลยว่าเป็นการตัดสินใจที่ถูกต้อง PAS ไม่ได้ช่วยเราเพียงเรื่องบัญชี แต่ยังเป็นที่ปรึกษาที่เชื่อถือได้ เมื่อต้องการคำชี้แนะเราจะมองหา PAS เสมอ ธุรกิจของผมเติบโตขึ้นอย่างมีคุณภาพ และผมยินดีที่ได้เห็นเราทั้งสองบริษัทเติบโตไปพร้อมๆ กัน ซึ่งพิสูจน์ได้จากออฟฟิศใหม่ของ PAS ผมภูมิใจและขอบคุณสำหรับมิตรภาพที่มีมาอย่างยาวนาน',
      en: 'I have known PAS through my parents when they were working with them. My first impression was ‘They are very good’ at what they do; their work has been nothing but exceptional and they have always taken good care of our business. When I started my own business, my wife and I chose PAS to be our accountant, and I can say that we made the right decision. PAS not only supports us in terms of accounting but is also a reliable consultant for us. In times of need, we always look to PAS for guidance. As a result, my business has grown significantly, and I’m very pleased to see that we are ‘growing together’ — proven by the new PAS office, which is very elegant and professional. I’m very proud and thankful for our friendship over the years.',
    },
    name: 'K. Sompop Jutaputhi & K. Wassana Boonphathip',
    role: 'Managing directors of Star Project Chiangmai 2 Co., Ltd.',
    photo: '/img/people/sompop.webp',
    logo: '/img/clients/pt.webp',
    logoAlt: 'PT',
  },
  {
    quote: {
      th: 'เราดีใจที่ได้ร่วมงานกับ PAS พวกเขามีความเป็นมืออาชีพ และพิสูจน์แล้วว่าสามารถให้คำแนะนำที่เชื่อถือได้แก่เรา',
      en: 'We are very happy to be working with PAS. They are very professional and have proved to provide reliable guidance.',
    },
    name: 'K. Vikromjit Sachathep',
    role: 'Managing director of Compass Skyview Hotel',
    photo: '/img/people/vikromjit.webp',
    logo: '/img/clients/skyview.webp',
    logoAlt: 'Compass Skyview Hotel',
  },
];

export const about = {
  title: { th: 'เกี่ยวกับเรา', en: 'About us' },
  lead: { th: 'ประวัติความเป็นมาของบริษัท วิสัยทัศน์ และพบกับทีมงานของเรา', en: 'Learn about the company background, vision and meet our team' },
  historyTitle: { th: 'ประวัติบริษัท', en: 'Company background' },
  history: [
    {
      th: 'บริษัท โพรเฟสชั่นแนล แอคเคาน์ติ้ง เซอร์วิส จำกัด ก่อตั้งขึ้นเมื่อปี 2539 โดยคุณยัสมีตกอร์ คาร์นิยอร์',
      en: 'Professional Accounting Service Co.,Ltd. was founded in 1996 by Mrs Jasmeetkaur Kharnijor.',
    },
    {
      th: 'บริษัทก่อตั้งขึ้นเพื่อให้บริการจัดทำบัญชีตามคำร้องขอของลูกค้ากลุ่มแรก และเติบโตขึ้นเรื่อยมา ปัจจุบันเรามีพนักงานมากกว่า 30 คน และให้บริการลูกค้ามากกว่า 150 ราย',
      en: 'The company was originated to serve the bookkeeping requests of our first group of clients. The business has been growing since then and now employs more than 30 staff serving more than 150 clients.',
    },
    {
      th: 'เพื่อรองรับฐานลูกค้าที่เพิ่มขึ้น เราได้ย้ายสำนักงานมาหลายแห่ง และในปี 2562 ได้ย้ายมาที่ตั้งปัจจุบัน ต.หนองป่าครั่ง เพื่อให้บริการลูกค้าได้อย่างเหมาะสม',
      en: 'To support our growing number of clients, we moved to several locations in the past, and in 2019 we moved to our current office in Nong Pa Khrang to properly provide services to our clients.',
    },
    {
      th: 'รากฐานหลักของเราคือ ลูกค้า คุณภาพ และความเป็นเลิศ เราให้ความสำคัญกับลูกค้าเป็นอันดับแรก และให้บริการตามความต้องการของธุรกิจด้วยงานที่มีคุณภาพ ผ่านความเข้าใจอย่างลึกซึ้งทั้งด้านธุรกิจและความเชี่ยวชาญด้านบัญชี',
      en: 'The core foundation of our business is client, quality and excellence. We put our clients first and serve according to their business demands with quality and excellence through our deep understanding of both business and proficient expertise.',
    },
  ],
  timeline: [
    { year: { th: '2539', en: '1996' }, text: { th: 'ก่อตั้งบริษัท', en: 'Company founded' } },
    { year: { th: '2562', en: '2019' }, text: { th: 'ย้ายมาสำนักงานปัจจุบัน ต.หนองป่าครั่ง', en: 'Moved to our current office in Nong Pa Khrang' } },
    { year: { th: 'วันนี้', en: 'Today' }, text: { th: 'ทีมงาน 30+ คน ลูกค้า 150+ ราย', en: '30+ staff, 150+ clients' } },
  ],
  certText: {
    th: 'เราได้รับการรับรองเป็นสำนักงานบัญชีคุณภาพจากกรมพัฒนาธุรกิจการค้า และมาตรฐาน ISO 9001:2015 ซึ่งเป็นหลักฐานที่ดีที่สุดของการทำงานอย่างมีคุณภาพและมีประสิทธิภาพ',
    en: 'The award and certification we received from the Department of Business Development (DBD) for a Certified Quality Accounting Practice and ISO 9001:2015 are the best supporting evidence that we live our values.',
  },
  missionTitle: { th: 'พันธกิจ', en: 'Our mission' },
  mission: [
    {
      th: 'บริษัท โพรเฟสชั่นแนล แอคเคาน์ติ้ง เซอร์วิส จำกัด และบริษัทในเครือ มีจุดมุ่งหมายที่จะมอบบริการที่เป็นเลิศ ผ่านความเชี่ยวชาญของบุคลากรของเรา',
      en: 'Professional Accounting Service Co.,Ltd. and its subsidiaries are a professional accounting and consulting firm which aims to provide excellent services to our clients using our expertise through our people.',
    },
    {
      th: 'ความต้องการของลูกค้าคือศูนย์กลาง เราทำงานร่วมกับลูกค้าในฐานะพันธมิตรที่เท่าเทียมกัน เพื่อรักษาความพึงพอใจและช่วยให้ลูกค้าบรรลุเป้าหมายทางธุรกิจ',
      en: 'Our clients’ needs are the center of our attention. We work hand in hand with our clients as equal partners to retain client satisfaction and achieve their desired business results.',
    },
  ],
  visionTitle: { th: 'วิสัยทัศน์และนโยบายคุณภาพ', en: 'Vision & quality policy' },
  vision: [
    {
      th: 'เป็นบริษัทบัญชีและที่ปรึกษาธุรกิจที่ลูกค้าเลือกเป็นอันดับแรก ด้วยบริการที่ครบวงจรเกี่ยวกับธุรกิจและบัญชีทุกประเภท',
      en: 'It is our vision to be the go-to accounting and consulting firm for our clients and potential clients, providing all sorts of business and accounting related services.',
    },
    {
      th: 'เป็นพันธมิตรทางธุรกิจที่สามารถส่งมอบและสนับสนุนลูกค้าให้บรรลุเป้าหมายและวัตถุประสงค์ที่ตั้งไว้',
      en: 'This is to be a business partner that can deliver and support them to achieve their business goals and objectives.',
    },
  ],
  teamTitle: { th: 'พบกับทีม PAS', en: 'Meet the PAS team' },
};

export const team: { name: T; role: T; yoe?: number; qualification: T; experience: T[]; photo: string }[] = [
  {
    name: { th: 'กรวิชญ์ คาร์นิยอร์', en: 'Koravich Kharnijor' },
    role: { th: 'กรรมการผู้จัดการ', en: 'Managing Director' },
    yoe: 10,
    qualification: { th: 'ผู้เชี่ยวชาญด้านการพัฒนาองค์กรและการบริหารสำนักงาน', en: 'Organization Development practitioner' },
    experience: [
      { th: 'ผู้นำสูงสุด ชี้แนะและนำทางบริษัทสู่อนาคตและความท้าทาย', en: 'Be a supreme leader, directing and guiding the firm towards the future and its challenges' },
      { th: 'ผู้นำงานที่ปรึกษา งานทะเบียน และระบบบัญชีดิจิทัล', en: 'Lead consulting / registration / and digital accounting practice' },
      { th: 'ผู้อำนวยการโครงการตรวจสอบทุจริตทางการเงิน การสืบค้น และการปรับปรุงกระบวนการในหลายอุตสาหกรรม', en: 'Project director in F&A forensic / investigation and process improvement initiatives in multiple industries' },
      { th: 'ที่ปรึกษาด้านทรัพยากรมนุษย์และการพัฒนาองค์กรให้บริษัทข้ามชาติและ SME ในไทยและต่างประเทศ', en: 'Experienced in HR consulting and organization development initiatives for multinational firms and SMEs in Thailand and other countries' },
      { th: 'ที่ปรึกษาด้านกลยุทธ์และเทคโนโลยีสารสนเทศ', en: 'Strategy consulting and IT related consultations' },
    ],
    photo: '/img/team/koravich.webp',
  },
  {
    name: { th: 'ปิยะพร คาร์นิยอร์', en: 'Piyaporn Kharnijor' },
    role: { th: 'ผู้จัดการ', en: 'Manager' },
    yoe: 10,
    qualification: { th: 'ผู้นำด้านทรัพยากรบุคคลและบริหารสำนักงาน', en: 'Human Resources & Operation Manager' },
    experience: [
      { th: 'ผู้นำด้านทรัพยากรบุคคล การจัดหาบุคลากร และการจัดอบรมสัมมนา', en: 'Lead of Human Resources / Recruitment / Training Development' },
      { th: 'ผู้นำการบริหารสำนักงานและการตลาดออนไลน์', en: 'Lead of Operation in organization / online Marketing' },
      { th: 'ประสบการณ์ในธุรกิจโรงแรมและการท่องเที่ยวจากแบรนด์ระดับสากล', en: 'Experience in Hospitality & Tourism Industries in international brands' },
      { th: 'ผู้ดูแลการจัดทำเงินเดือน', en: 'Lead of Payroll / Paymaster' },
    ],
    photo: '/img/team/piyaporn.webp',
  },
  {
    name: { th: 'กรรณพา ยกย่อง', en: 'Kannapa Yokyong' },
    role: { th: 'ผู้จัดการอาวุโส', en: 'Senior Manager' },
    yoe: 15,
    qualification: { th: 'ผู้นำด้านการตรวจสอบบัญชี และผู้สอบบัญชีภาษีอากร (TA)', en: 'Auditing Manager, Tax Auditor' },
    experience: [
      { th: 'นำโครงการตรวจสอบบัญชีให้บริษัทขนาดกลางและขนาดย่อมทั่วประเทศ', en: 'Led auditing projects for small and medium companies across the country' },
      { th: 'ผู้สอบบัญชีภาษีอากรรับอนุญาต ให้คำแนะนำเชิงปฏิบัติในเรื่องภาษี', en: 'Certified tax auditor providing practical guidance in tax related matters' },
      { th: 'ผู้นำทีมบัญชีในอุตสาหกรรมการบริการและการโรงแรม', en: 'Lead the accounting workstream related to the hospitality management industry' },
      { th: 'วิทยากรและผู้ฝึกสอนหลักสูตรภาษี การสอบบัญชี และการบัญชี', en: 'Guest speaker and trainer for tax, auditing, and accounting courses' },
    ],
    photo: '/img/team/kannapa.webp',
  },
  {
    name: { th: 'กุลรัศมิ์ คำออน', en: 'Kullarat Kum-on' },
    role: { th: 'ผู้จัดการ', en: 'Manager' },
    yoe: 15,
    qualification: { th: 'ผู้นำด้านงานทะเบียนและพัฒนาคุณภาพ ผู้ทำบัญชี (CPD)', en: 'Lead the business registration and Quality Development' },
    experience: [
      { th: 'ดูแลงานทะเบียนของบริษัท และให้คำแนะนำการดำเนินเรื่องและเอกสารกับหน่วยงานภาครัฐแก่ลูกค้า', en: 'Lead the business registration practice for the firm, providing government related administration guidance to clients' },
      { th: 'ดูแลระบบบริหารคุณภาพ ISO 9001', en: 'Internal general manager providing related support to internal staff and clients' },
      { th: 'ที่ปรึกษาด้านภาษีบุคคลธรรมดาให้แก่ลูกค้า', en: 'Lead the personal tax consultation for clients' },
    ],
    photo: '/img/team/kullarat.webp',
  },
  {
    name: { th: 'พรรณพิไล โนจา', en: 'Punpilai Noja' },
    role: { th: 'ผู้จัดการ', en: 'Manager' },
    yoe: 15,
    qualification: { th: 'ผู้นำด้านบัญชี ผู้ทำบัญชี (CPD)', en: 'Accounting Manager' },
    experience: [
      { th: 'ผู้นำงานบัญชีที่เกี่ยวข้องกับธุรกรรมและโครงการอสังหาริมทรัพย์', en: 'Lead the accounting workstream related to real estate transactions and projects' },
      { th: 'บริหารกระบวนการปิดบัญชีรายเดือน รายไตรมาส และรายปี', en: 'Manage monthly, quarterly, and annual closing processes' },
      { th: 'ประสานงานกับผู้สอบบัญชี ที่ปรึกษาภาษี และผู้เกี่ยวข้อง', en: 'Coordinate with auditors, tax consultants, and related stakeholders' },
    ],
    photo: '/img/team/punpilai.webp',
  },
  {
    name: { th: 'วาริกา เทพหินลัพ', en: 'Variga Thephinlup' },
    role: { th: 'ผู้จัดการ', en: 'Manager' },
    qualification: { th: 'ผู้จัดการบัญชี (CPD)', en: 'Accounting Manager' },
    experience: [
      { th: 'เข้าใจการบัญชีรายได้และค่าใช้จ่ายในธุรกิจบริการ (โรงแรม ร้านอาหาร บริษัททัวร์ ฯลฯ)', en: 'Strong understanding of revenue and expense accounting in the service industry (hotel, restaurant, travel agent, etc.)' },
      { th: 'จัดทำงบการเงินและรายงานเพื่อการตัดสินใจของผู้บริหาร', en: 'Skilled in preparing financial statements and management reports for decision-making' },
      { th: 'มีความรู้ด้านภาษีมูลค่าเพิ่ม ภาษีหัก ณ ที่จ่าย บริหารการปิดบัญชีประจำเดือน และประสานงานกับหน่วยงานที่เกี่ยวข้อง', en: 'Knowledgeable in VAT and withholding tax; capable of managing monthly closing and coordinating with related parties' },
    ],
    photo: '/img/team/variga.webp',
  },
];

export const testimonialsPage = {
  title: { th: 'เสียงจากลูกค้า', en: 'Testimonials' },
  lead: { th: 'รับฟังความคิดเห็นของลูกค้าที่พูดถึงเรา', en: 'Hear what our clients have to say about us' },
};

export const contactPage = {
  title: { th: 'ติดต่อเรา', en: 'Contact us' },
  lead: { th: 'มาพูดคุยความต้องการด้านบัญชี ภาษี และที่ปรึกษากัน', en: 'Let’s talk about your accounting and consulting needs' },
  office: { th: 'สำนักงานเชียงใหม่', en: 'Chiang Mai office' },
  hours: { th: 'เวลาทำการ', en: 'Business hours' },
  channels: { th: 'ช่องทางติดต่อ', en: 'Contact us at' },
  email: { th: 'อีเมล', en: 'Email' },
  phone: { th: 'โทรศัพท์', en: 'Telephone' },
  formTitle: { th: 'ต้องการใบเสนอราคาหรือสมัครอบรม?', en: 'Need a quote or want to join a training?' },
  formLead: {
    th: 'กรอกแบบฟอร์มออนไลน์ แล้วทีมงานจะติดต่อกลับโดยเร็ว',
    en: 'Fill in our online form and our team will get back to you shortly.',
  },
};

export function t(x: T, lang: Locale) {
  return x[lang];
}

export function yearsSinceFounded(now = new Date()) {
  return now.getFullYear() - FOUNDED;
}

/** "/about" → "/th/about"; "/#services" → "/th#services". */
export function href(lang: Locale, path: string) {
  if (path.startsWith('/#')) return `/${lang}${path.slice(1)}`;
  return `/${lang}${path}`;
}

/** Labels for the navy/gold homepage. Facts only from the legacy site (no new claims). */
export const landing = {
  utilityLocation: { th: 'อ.เมืองเชียงใหม่ จ.เชียงใหม่', en: 'Mueang Chiang Mai, Thailand' },
  utilityBadge: { th: 'สำนักงานบัญชีคุณภาพ DBD · ISO 9001:2015', en: 'DBD Quality Accounting Practice · ISO 9001:2015' },
  servicesBadge: { th: '8 บริการ', en: '8 services' },
  eyebrow: { th: 'ก่อตั้ง พ.ศ. 2539 · ประสบการณ์กว่า {years} ปี', en: 'Established 1996 · {years} years of practice' },
  brandTag: { th: 'สำนักงานบัญชีคุณภาพ', en: 'Quality accounting practice' },
  brandSince: { th: 'ก่อตั้ง พ.ศ. 2539 · เชียงใหม่', en: 'Since 1996 · Chiang Mai' },
  hq: { th: 'สำนักงานใหญ่ จ.เชียงใหม่', en: 'Headquartered in Chiang Mai' },
  pillars: [
    {
      icon: 'history',
      tag: { th: 'ประวัติ', en: 'Heritage' },
      value: 'years',
      title: { th: 'ปีแห่งประสบการณ์', en: 'Years of continuous practice' },
      desc: {
        th: 'ก่อตั้งปี 2539 โดยคุณยัสมีตกอร์ คาร์นิยอร์ และเติบโตต่อเนื่องมาจนถึงวันนี้',
        en: 'Founded in 1996 by Mrs Jasmeetkaur Kharnijor and growing ever since.',
      },
      foot: { th: 'ตั้งแต่ พ.ศ. 2539', en: 'Since 1996' },
    },
    {
      icon: 'clients',
      tag: { th: 'ลูกค้า', en: 'Clients' },
      value: 150,
      title: { th: 'ธุรกิจที่ไว้วางใจเรา', en: 'Businesses served' },
      desc: {
        th: 'ทั้งธุรกิจของชาวไทยและชาวต่างชาติ บางรายร่วมงานกับเรามานานกว่า 20 ปี',
        en: 'Thai and foreign-owned businesses — some have worked with us for over 20 years.',
      },
      foot: { th: 'พันธมิตรระยะยาว', en: 'Long-term partners' },
    },
    {
      icon: 'team',
      tag: { th: 'ทีมงาน', en: 'Team' },
      value: 30,
      title: { th: 'นักบัญชีและที่ปรึกษา', en: 'Accountants & consultants' },
      desc: {
        th: 'ให้บริการทั้งแบบตัวต่อตัวที่สำนักงานเชียงใหม่และทางออนไลน์',
        en: 'Serving clients both in person at our Chiang Mai office and online.',
      },
      foot: { th: 'ผู้ทำบัญชี CPD · ผู้สอบบัญชีภาษีอากร', en: 'CPD accountants · Tax auditor' },
    },
  ],
  ribbonTitle: { th: 'การรับรองและมาตรฐาน', en: 'Accreditations & standards' },
  ribbon: [
    { icon: 'badge', title: { th: 'สำนักงานบัญชีคุณภาพ', en: 'Certified Quality Accounting Practice' }, sub: { th: 'กรมพัฒนาธุรกิจการค้า', en: 'Department of Business Development' } },
    { icon: 'shield', title: { th: 'ISO 9001:2015', en: 'ISO 9001:2015' }, sub: { th: 'ระบบบริหารคุณภาพ', en: 'Quality management system' } },
    { icon: 'award', title: { th: 'รับรองโดย URS', en: 'Certified by URS' }, sub: { th: 'United Registrar of Systems', en: 'United Registrar of Systems' } },
    { icon: 'cap', title: { th: 'ผู้ทำบัญชี (CPD)', en: 'CPD accountants' }, sub: { th: 'ทีมผู้จัดการบัญชี', en: 'Accounting managers' } },
    { icon: 'file', title: { th: 'ผู้สอบบัญชีภาษีอากร (TA)', en: 'Tax Auditor (TA)' }, sub: { th: 'งานตรวจสอบบัญชี', en: 'Auditing practice' } },
  ],
  philosophyEyebrow: { th: 'รากฐานของเรา', en: 'Our foundation' },
  philosophyTitle: { th: 'ปรัชญา 3C ของ PAS', en: 'The PAS 3C philosophy' },
  philosophyLead: {
    th: 'Commitment · Consult · Customer — สามหลักที่เรายึดถือในการดูแลธุรกิจของลูกค้า',
    en: 'Commitment · Consult · Customer — the three principles behind how we look after your business.',
  },
  servicesEyebrow: { th: 'บริการ 8 ด้าน', en: '8 areas of practice' },
  askAbout: { th: 'สอบถามบริการนี้', en: 'Ask about this' },
  officeEyebrow: { th: 'สำนักงานของเรา', en: 'Our office' },
  officeCard: { th: 'สำนักงานเชียงใหม่', en: 'Chiang Mai office' },
  addressLabel: { th: 'ที่ตั้งสำนักงาน', en: 'Office address' },
  inPerson: { th: 'พบที่สำนักงาน', en: 'In-person meetings' },
  online: { th: 'บริการออนไลน์', en: 'Online service' },
  consultEyebrow: { th: 'ปรึกษาเรา', en: 'Talk to us' },
  quoteSub: { th: 'Request a quote', en: 'ขอใบเสนอราคา' },
  trust: [
    { icon: 'clock', text: { th: 'จันทร์–ศุกร์ 8.00–18.00 น.', en: 'Mon–Fri, 8 AM – 6 PM' } },
    { icon: 'badge', text: { th: 'DBD · ISO 9001:2015', en: 'DBD · ISO 9001:2015' } },
    { icon: 'team', text: { th: 'นักบัญชีและที่ปรึกษากว่า 30 คน', en: '30+ accountants & consultants' } },
  ],
};
