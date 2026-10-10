// ERD 의 코드값(enum). 마이그레이션의 CHECK 와 validators 가 이 목록을 함께 쓴다.
export const ROLES = ['SELLER', 'BUYER', 'ADMIN'];
export const SELLER_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
export const SALE_TYPES = ['SCRAP', 'ROLL'];
export const FABRIC_STATUSES = ['PENDING', 'POSTED', 'REJECTED', 'SOLD_OUT'];
export const MATERIALS = ['COTTON', 'LINEN', 'POLYESTER', 'NYLON', 'RAYON', 'WOOL', 'BLEND', 'ETC', 'UNKNOWN'];
export const THICKNESSES = ['THIN', 'NORMAL', 'THICK'];
export const COLOR_FAMILIES = [
  'WHITE', 'BLACK', 'GRAY', 'BEIGE', 'BROWN', 'RED', 'PINK',
  'YELLOW', 'GREEN', 'BLUE', 'NAVY', 'PURPLE', 'MIXED',
];
export const IMAGE_TYPES = ['FULL', 'ZOOM', 'DEFECT'];
export const RESERVATION_STATUSES = ['REQUESTED', 'ACCEPTED', 'REJECTED', 'CANCELED', 'PICKED_UP'];
export const CANCELED_BY = ['BUYER', 'SELLER'];
export const FAVORITE_TARGETS = ['FABRIC', 'PATTERN'];
export const INQUIRY_STATUSES = ['WAITING', 'ANSWERED'];
