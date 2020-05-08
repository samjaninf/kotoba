const glob = require('glob');
const fs = require('fs');
const path = require('path');
const FontKit = require('fontkit');
const colorValidator = require('validate-color');

const RANDOM_FONT_ALIAS = 'random';

function validateHTMLColor(color) {
  return colorValidator.validateHTMLColor(color)
    || colorValidator.validateHTMLColorHex(color)
    || colorValidator.validateHTMLColorName(color);
}

function getRandomElement(arr) {
  const randomIndex = Math.floor(Math.random() * arr.length);
  return arr[randomIndex];
}

function buildSupportedCharactersForFontMap(fontsLocal) {
  const supportedCharactersForFontFamilyLocal = {};
  fontsLocal.forEach((font) => {
    supportedCharactersForFontFamilyLocal[font.fontFamily] = {};
    font.filePaths.forEach((filePath) => {
      const fontKitFont = FontKit.openSync(filePath);
      const fontKitFonts = fontKitFont.fonts || [fontKitFont];

      // font.characterSet contains code points that the font doesn't actually support.
      // Not 100% sure how fonts work in this respect, but this is the only reliable
      // way I could find to figure out which characters are actually supported.
      fontKitFonts.forEach((fontKitFont) => {
        fontKitFont.characterSet.forEach((char) => {
          const glyph = fontKitFont.glyphForCodePoint(char);
          try {
            const space = 32;
            if (Number.isFinite(glyph.path.cbox.height) || glyph.layers || char === space) {
              const str = String.fromCodePoint(char);
              supportedCharactersForFontFamilyLocal[font.fontFamily][str] = true;
            }
          } catch (err) {
            // NOOP. Some of the properties on glyph are getters that error
            // if the glyph isn't supported. Catch those errors and skip the glyph.
          }
        });
      });
    });
  });

  return supportedCharactersForFontFamilyLocal;
}

function fontFamilyCanRenderCharacter(supportedCharactersForFontFamily, fontFamily, character) {
  return supportedCharactersForFontFamily[fontFamily]
    && supportedCharactersForFontFamily[fontFamily][character];
}

class FontHelper {
  constructor() {
    this.fonts = [];
    this.allowedFonts = [];
    this.supportedCharactersForFontFamily = {};
  }

  loadFontsSync(fontsPath, supportedCharacterMapPath) {
    this.fonts = [];
  
    const fontMetaFilePaths = glob.sync(`${fontsPath}/**/meta.json`);
    fontMetaFilePaths.forEach((metaPath) => {
      // eslint-disable-next-line global-require,import/no-dynamic-require
      const meta = JSON.parse(fs.readFileSync(metaPath));
      const dir = path.dirname(metaPath);
      const fontFilePaths = glob.sync(`${dir}/*.{otf,ttf,ttc}`);
      this.fonts.push({
        filePaths: fontFilePaths,
        fontFamily: meta.fontFamily,
        order: meta.order,
        description: meta.description,
        hidden: !!meta.hidden,
      });
    });
  
    try {
      this.supportedCharactersForFontFamily = JSON.parse(fs.readFileSync(supportedCharacterMapPath));
    } catch (err) {
      // NOOP
    }

    if (this.fonts.some(f => !this.supportedCharactersForFontFamily[f.fontFamily])) {
      this.supportedCharactersForFontFamily = buildSupportedCharactersForFontMap(this.fonts);

      if (supportedCharacterMapPath) {
        fs.mkdirSync(path.dirname(supportedCharacterMapPath), { recursive: true });
        fs.writeFileSync(
          supportedCharacterMapPath,
          JSON.stringify(this.supportedCharactersForFontFamily),
        );
      }
    }
  
    this.fonts.sort((a, b) => a.order - b.order);
    this.allowedFonts = this.fonts.filter(f => !f.hidden);
  }

  registerFonts(canvas) {
    this.fonts.forEach((font) => {
      font.filePaths.forEach((filePath) => {
        canvas.registerFont(filePath, { family: font.fontFamily });
      });
    });
  }

  getFontForAlias(fontAlias) {
    if (fontAlias.toLowerCase() === RANDOM_FONT_ALIAS) {
      return getRandomElement(this.fonts);
    }
  
    const font = this.fonts.find(f => f.fontFamily === fontAlias);
    return font || this.fonts[0];
  }

  fontFamilyCanRenderString(fontFamily, string) {
    const characters = Array.from(string);
    return characters.every(c => fontFamilyCanRenderCharacter(
      this.supportedCharactersForFontFamily,
      fontFamily,
      c,
    ));
  }

  coerceFontFamily(fontFamily, string) {
    if (this.fontFamilyCanRenderString(fontFamily, string)) {
      return fontFamily;
    }
  
    const supportedFont = this.fonts.find(f => this.fontFamilyCanRenderString(
      f.fontFamily,
      string,
    ));
    
    return (supportedFont || {}).fontFamily || this.fonts[0].fontFamily;
  }

  parseFontArgs(str) {
    const parseResult = {};
  
    parseResult.remainingString = str
      .replace(/,\s+/g, ',').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
      .replace(/font\s*=\s*([0-9]*)/ig, (m, g1) => {
        const fontInt = parseInt(g1, 10);
        parseResult.fontFamily = (this.allowedFonts[fontInt - 1] || {}).fontFamily;
  
        if (!parseResult.fontFamily) {
          parseResult.errorDescriptionShort = 'Invalid font';
          parseResult.errorDescriptionLong = `Please provide a number between 1 and ${this.allowedFonts.length} as your font= setting.`;
        }
  
        return '';
      })
      .replace(/bgcolor\s*=\s*(\S*)/ig, (m, g1) => {
        parseResult.bgColor = g1.toLowerCase();
  
        if (!validateHTMLColor(parseResult.bgColor)) {
          parseResult.errorDescriptionShort = 'Invalid bgcolor';
          parseResult.errorDescriptionLong = 'Please enter a valid HTML color as your bgcolor= setting.';
        }
  
        return '';
      })
      .replace(/color\s*=\s*(\S*)/ig, (m, g1) => {
        parseResult.color = g1.toLowerCase();
  
        if (!validateHTMLColor(parseResult.color)) {
          parseResult.errorDescriptionShort = 'Invalid color';
          parseResult.errorDescriptionLong = 'Please enter a valid HTML color as your color= setting.';
        }
  
        return '';
      })
      .replace(/size\s*=\s*([0-9]*)/ig, (m, g1) => {
        parseResult.size = parseInt(g1, 10);
  
        if (parseResult.size < 20 || parseResult.size > 200) {
          parseResult.errorDescriptionShort = 'Invalid size';
          parseResult.errorDescriptionLong = 'Please enter a number between 20 and 200 as your size= setting.';
        }
  
        return '';
      })
      .trim();
  
    return parseResult;
  }
}

FontHelper.validateHTMLColor = validateHTMLColor;
FontHelper.prototype.validateHTMLColor = validateHTMLColor;
FontHelper.RANDOM_FONT_ALIAS = RANDOM_FONT_ALIAS;
FontHelper.prototype.RANDOM_FONT_ALIAS = RANDOM_FONT_ALIAS;

module.exports = FontHelper;
