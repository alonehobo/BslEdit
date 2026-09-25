import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSession } from '../src/browser-session.js';
import { ViewerController } from '../src/controller.js';
import { FileLoader } from '../src/files.js';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDir = path.resolve(packageDir, '..', '..');
const builtAssetsDir = path.join(packageDir, 'build', 'web');
let assetsDir = builtAssetsDir;
let isolatedAssetsRoot = '';
const maxBytes = 64 * 1024 * 1024;

test.before(async () => {
  isolatedAssetsRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-viewer-e2e-assets-'));
  assetsDir = path.join(isolatedAssetsRoot, 'web');
  await fs.cp(builtAssetsDir, assetsDir, { recursive: true });
});
test.after(async () => {
  if (isolatedAssetsRoot) {
    await fs.rm(isolatedAssetsRoot, { recursive: true, force: true });
  }
});

function options(root: string) {
  return {
    roots: [root],
    allowAnyPath: false,
    viewport: { width: 640, height: 480 },
    headless: true,
    maxBytes,
    assetsDir,
  };
}

function nestedForm(): string {
  const longFields = Array.from({ length: 35 }, (_, index) =>
    `<InputField name="Поле${index}" id="${200 + index}"><DataPath>Объект.Поле${index}</DataPath></InputField>`,
  ).join('');
  const columns = Array.from({ length: 18 }, (_, index) =>
    `<InputField name="Колонка${index}" id="${300 + index}"><DataPath>Объект.Таблица.Колонка${index}</DataPath></InputField>`,
  ).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <Pages name="ВнешниеСтраницы" id="100"><ChildItems>
      <Page name="Первая" id="101"><ChildItems><LabelDecoration name="ПерваяНадпись" id="103"/></ChildItems></Page>
      <Page name="Вторая" id="102"><ChildItems>
        <Pages name="ВложенныеСтраницы" id="110"><ChildItems>
          <Page name="ВложеннаяПервая" id="111"><ChildItems><LabelDecoration name="ВложеннаяНадпись" id="114"/></ChildItems></Page>
          <Page name="ВложеннаяВторая" id="112"><ChildItems>
            <UsualGroup name="ДлиннаяГруппа" id="120"><Group>Vertical</Group><ChildItems>${longFields}</ChildItems></UsualGroup>
            <Table name="Таблица" id="130"><DataPath>Объект.Таблица</DataPath><ChildItems>${columns}</ChildItems></Table>
          </ChildItems></Page>
          <Page name="ТабличныйДокументСтраница" id="115"><ChildItems>
            <SpreadSheetDocumentField name="ТабличныйДокумент" id="140"/>
          </ChildItems></Page>
        </ChildItems></Pages>
      </ChildItems></Page>
    </ChildItems></Pages>
  </ChildItems>
</Form>`;
}

/* Element ids repeat across unrelated 1C forms — both of these number their
 * pages 101 and 102 — which is exactly how one document's selected tab used to
 * end up deciding the next document's layout. */
function twinPagesForm(marker: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
  <ChildItems>
    <Pages name="Страницы${marker}" id="100"><ChildItems>
      <Page name="Первая${marker}" id="101"><ChildItems><LabelDecoration name="Надпись1${marker}" id="103"/></ChildItems></Page>
      <Page name="Вторая${marker}" id="102"><ChildItems><LabelDecoration name="Надпись2${marker}" id="104"/></ChildItems></Page>
    </ChildItems></Pages>
  </ChildItems>
</Form>`;
}

function emptyManualTableBarForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
  <ChildItems>
    <Table name="Дерево" id="15">
      <Representation>Tree</Representation>
      <AutoCommandBar name="ДеревоКоманднаяПанель" id="17"><Autofill>false</Autofill></AutoCommandBar>
      <SearchStringAddition name="ДеревоСтрокаПоиска" id="18"/>
      <ViewStatusAddition name="ДеревоСостояниеПросмотра" id="19"/>
      <ChildItems><InputField name="Наименование" id="20"/></ChildItems>
    </Table>
  </ChildItems>
</Form>`;
}

function structuredRuntimeForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:v8ui="http://v8.1c.ru/8.1/data/ui" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CreateButtonsGroupPicture><xr:Ref>StdPicture.Create</xr:Ref></CreateButtonsGroupPicture>
  <AutoCommandBar name="FormBar" id="-1"><Autofill>false</Autofill><ChildItems>
    <Popup name="CreateBasedOn" id="10"><Title>Create based on</Title><ChildItems><Button name="CreateOrder" id="11"><Title>Order</Title></Button></ChildItems></Popup>
  </ChildItems></AutoCommandBar>
  <ChildItems>
    <InputField name="Customer" id="20"><ChoiceButton>true</ChoiceButton>
      <ChoiceParameterLinks><xr:item name="Company" mode="Clear"><xr:dataPath>Object.Company</xr:dataPath></xr:item></ChoiceParameterLinks>
      <ChoiceParameters><v8:item><v8:name>Filter.Owner</v8:name><v8:value xsi:type="xs:string">Main</v8:value></v8:item></ChoiceParameters>
      <Border width="1"><v8ui:style xsi:type="v8ui:ControlBorderType">WithoutBorder</v8ui:style></Border>
    </InputField>
    <UsualGroup name="PictureGroup" id="30"><BackPicture><xr:Ref>CommonPicture.Background</xr:Ref></BackPicture><ChildItems><LabelDecoration name="Text" id="31"><Title>Text</Title></LabelDecoration></ChildItems></UsualGroup>
    <Table name="DefaultTable" id="40"><Footer>true</Footer><Period><v8:variant xsi:type="v8:StandardPeriodVariant">Custom</v8:variant></Period><RowFilter xsi:nil="true"/><ChildItems><InputField name="Amount" id="41"><ShowInFooter>true</ShowInFooter><FooterPicture><xr:Ref>StdPicture.Warning</xr:Ref></FooterPicture></InputField></ChildItems></Table>
    <Table name="ActiveTable" id="50"><Period><v8:variant xsi:type="v8:StandardPeriodVariant">Custom</v8:variant><v8:beginDate>2026-09-01T00:00:00</v8:beginDate></Period><RowFilter><v8:item name="Status"><v8:value>Open</v8:value></v8:item></RowFilter><ChildItems><InputField name="Name" id="51"/></ChildItems></Table>
  </ChildItems>
</Form>`;
}

function pageLocalOverflowWithRootHeaderForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Group>Vertical</Group>
  <ChildItems>
    <UsualGroup name="Header" id="10"><HorizontalStretch>true</HorizontalStretch><Group>Vertical</Group>
      <HorizontalAlign>Right</HorizontalAlign><Representation>None</Representation><ShowTitle>false</ShowTitle><ChildItems>
        <RadioButtonField name="Visibility" id="11"><TitleLocation>None</TitleLocation><RadioButtonType>Tumbler</RadioButtonType>
          <ColumnsCount>2</ColumnsCount><ChoiceList>
            <xr:Item><xr:Presentation><v8:item><v8:lang>ru</v8:lang><v8:content>Показать все</v8:content></v8:item></xr:Presentation><xr:Value xsi:type="xs:string" xmlns:xs="http://www.w3.org/2001/XMLSchema">Show</xr:Value></xr:Item>
            <xr:Item><xr:Presentation><v8:item><v8:lang>ru</v8:lang><v8:content>Свернуть все</v8:content></v8:item></xr:Presentation><xr:Value xsi:type="xs:string" xmlns:xs="http://www.w3.org/2001/XMLSchema">Collapse</xr:Value></xr:Item>
          </ChoiceList>
        </RadioButtonField>
      </ChildItems></UsualGroup>
    <Pages name="Pages" id="20"><HorizontalStretch>true</HorizontalStretch><ChildItems>
      <Page name="Main" id="21"><ChildItems>
        <UsualGroup name="WideRow" id="22"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle><ChildItems>
          <InputField name="First" id="23"><Width>24</Width><HorizontalStretch>true</HorizontalStretch><Title>Клиент</Title></InputField>
          <InputField name="Second" id="24"><Width>24</Width><HorizontalStretch>true</HorizontalStretch><Title>Организация</Title></InputField>
          <LabelDecoration name="Restriction" id="25"><Title>Отгрузка клиенту запрещена</Title><Hyperlink>true</Hyperlink></LabelDecoration>
        </ChildItems></UsualGroup>
      </ChildItems></Page>
    </ChildItems></Pages>
  </ChildItems>
</Form>`;
}

function zeroWidthStretchForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
  <Group>Vertical</Group>
  <ChildItems>
    <UsualGroup name="Wrapper" id="10">
      <Group>Horizontal</Group>
      <Representation>NormalSeparation</Representation>
      <ShowTitle>false</ShowTitle>
      <ChildItems>
        <InputField name="Unlimited" id="11">
          <TitleLocation>Left</TitleLocation>
          <AutoMaxWidth>false</AutoMaxWidth>
          <Width>0</Width>
          <MaxWidth>0</MaxWidth>
        </InputField>
      </ChildItems>
    </UsualGroup>
  </ChildItems>
</Form>`;
}

function horizontalFooterForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Group>Vertical</Group>
  <ChildItems>
    <UsualGroup name="ГруппаПодвал" id="777">
      <Group>AlwaysHorizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle>
      <ChildItems>
        <UsualGroup name="ГруппаНижняяСтрока" id="889">
          <VerticalStretch>false</VerticalStretch><Group>Horizontal</Group>
          <Representation>None</Representation><ShowTitle>false</ShowTitle>
          <ChildItems>
            <UsualGroup name="ГруппаКомментарий" id="782">
              <Group>Horizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle>
              <ChildItems>
                <LabelDecoration name="Декорация2" id="784">
                  <Width>9</Width><VerticalStretch>true</VerticalStretch>
                  <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Комментарий:</v8:content></v8:item></Title>
                </LabelDecoration>
                <InputField name="Комментарий" id="179">
                  <DataPath>Объект.Комментарий</DataPath><TitleLocation>None</TitleLocation>
                  <AutoMaxWidth>false</AutoMaxWidth><Height>1</Height><VerticalStretch>false</VerticalStretch>
                </InputField>
              </ChildItems>
            </UsualGroup>
            <InputField name="Ответственный" id="779">
              <DataPath>Объект.Ответственный</DataPath><GroupHorizontalAlign>Right</GroupHorizontalAlign>
            </InputField>
          </ChildItems>
        </UsualGroup>
      </ChildItems>
    </UsualGroup>
  </ChildItems>
</Form>`;
}

function compactTotalsFooterForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Group>Vertical</Group>
  <ChildItems>
    <Pages name="Pages" id="910"><ChildItems><Page name="Main" id="911"><ChildItems>
      <InputField name="Comment" id="912"><Height>3</Height><HorizontalStretch>true</HorizontalStretch></InputField>
    </ChildItems></Page></ChildItems></Pages>
    <UsualGroup name="Footer" id="920"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
      <LabelDecoration name="Total" id="921"><Hyperlink>true</Hyperlink><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Итого</v8:content></v8:item></Title></LabelDecoration>
      <UsualGroup name="TotalsRow" id="922"><Group>Horizontal</Group><Representation>None</Representation><BackColor>style:ИтогиФон</BackColor><ChildItems>
        <LabelDecoration name="Edo" id="923"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Состояние ЭДО</v8:content></v8:item></Title></LabelDecoration>
        <UsualGroup name="BottomAmount" id="924"><VerticalStretch>true</VerticalStretch><Group>Vertical</Group><VerticalAlign>Bottom</VerticalAlign><Representation>None</Representation><ChildItems>
          <InputField name="Rejected" id="925"><ReadOnly>true</ReadOnly><Width>10</Width></InputField>
        </ChildItems></UsualGroup>
        <InputField name="Received" id="926"><ReadOnly>true</ReadOnly><Width>10</Width></InputField>
      </ChildItems></UsualGroup>
    </ChildItems></UsualGroup>
  </ChildItems>
</Form>`;
}

function constrainedHeaderForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Header" id="930"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
    <UsualGroup name="Left" id="931"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
      <UsualGroup name="NumberDate" id="932"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
        <InputField name="Number" id="933"><Width>11</Width><HorizontalStretch>false</HorizontalStretch></InputField>
        <InputField name="Date" id="934"><Width>13</Width></InputField>
      </ChildItems></UsualGroup><InputField name="Organization" id="935"><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>31</MaxWidth></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="Right" id="936"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
      <UsualGroup name="StatusRow" id="937"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
        <InputField name="Status" id="938"><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>31</MaxWidth></InputField>
        <Button name="Working" id="939"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>В работе</v8:content></v8:item></Title></Button>
        <InputField name="Logistician" id="940"><ChoiceButton>true</ChoiceButton></InputField>
      </ChildItems></UsualGroup><InputField name="Transit" id="941"><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>31</MaxWidth></InputField>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup>
  <Table name="Rows" id="945"><ChildItems>${Array.from({ length: 12 }, (_, i) => `<InputField name="Column${i}" id="${950 + i}"><Width>20</Width></InputField>`).join('')}</ChildItems></Table>
  <InputField name="Comment" id="970"><AutoMaxWidth>false</AutoMaxWidth><HorizontalStretch>true</HorizontalStretch></InputField>
</ChildItems></Form>`;
}

function rightAlignedAmountFooterForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Footer" id="980"><Group>AlwaysHorizontal</Group><Representation>None</Representation><HorizontalStretch>true</HorizontalStretch><ChildItems>
    <LabelDecoration name="RightSpacer" id="981"><AutoMaxWidth>false</AutoMaxWidth><HorizontalStretch>true</HorizontalStretch></LabelDecoration>
    <InputField name="Amount" id="982"><Width>18</Width><HorizontalStretch>false</HorizontalStretch><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Сумма документа:</v8:content></v8:item></Title></InputField>
  </ChildItems></UsualGroup>
</ChildItems></Form>`;
}

function reportSheetWithStatusBandsForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Group>Vertical</Group>
  <ChildItems>
    <UsualGroup name="Успех" id="10"><HorizontalStretch>true</HorizontalStretch>
      <Group>Horizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle>
      <BackColor>style:ЦветФонаУдачнойОтправки</BackColor><ChildItems>
        <LabelDecoration name="Этап" id="11"><Title formatted="false"><v8:item><v8:lang>ru</v8:lang><v8:content>&lt;Наименование этапа&gt;</v8:content></v8:item></Title></LabelDecoration>
        <LabelDecoration name="Протокол" id="12"><Hyperlink>true</Hyperlink><Title formatted="false"><v8:item><v8:lang>ru</v8:lang><v8:content>&lt;Протокол&gt;</v8:content></v8:item></Title></LabelDecoration>
      </ChildItems>
    </UsualGroup>
    <UsualGroup name="Ошибка" id="20"><HorizontalStretch>true</HorizontalStretch>
      <Group>Horizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle>
      <BackColor>style:ЦветФонаОшибкиОтправки</BackColor><ChildItems>
        <LabelDecoration name="ТекстОшибки" id="21"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Ошибка отправки</v8:content></v8:item></Title></LabelDecoration>
      </ChildItems>
    </UsualGroup>
    <UsualGroup name="Отчет" id="30"><Group>Horizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle><ChildItems>
      <Pages name="Страницы" id="31"><PagesRepresentation>None</PagesRepresentation><ChildItems><Page name="Форма" id="32"><ChildItems>
        <SpreadSheetDocumentField name="ПолеТабличногоДокумента" id="33"/>
      </ChildItems></Page></ChildItems></Pages>
    </ChildItems></UsualGroup>
    <UsualGroup name="Подвал" id="40"><Group>Horizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle><ChildItems>
      <InputField name="Комментарий" id="41"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Комментарий</v8:content></v8:item></Title><AutoMaxWidth>false</AutoMaxWidth></InputField>
    </ChildItems></UsualGroup>
  </ChildItems>
</Form>`;
}

function hiddenPagesVerticalTableForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Group>Vertical</Group>
  <ChildItems>
    <LabelDecoration name="Header" id="1"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Заголовок</v8:content></v8:item></Title></LabelDecoration>
    <Pages name="HiddenPages" id="10"><PagesRepresentation>None</PagesRepresentation><ChildItems>
      <Page name="ContentPage" id="11"><ChildItems>
        <Table name="RowsTable" id="12"><DataPath>Rows</DataPath><HorizontalStretch>true</HorizontalStretch><VerticalStretch>true</VerticalStretch><ChildItems>
          <InputField name="Value" id="13"><DataPath>Rows.Value</DataPath><Width>40</Width></InputField>
        </ChildItems></Table>
      </ChildItems></Page>
    </ChildItems></Pages>
  </ChildItems>
</Form>`;
}

function responsibleObjectMeta(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Document><Properties><Name>Документ</Name></Properties><ChildObjects>
    <Attribute><Properties><Name>Ответственный</Name><Type><v8:Type>cfg:CatalogRef.Пользователи</v8:Type></Type></Properties></Attribute>
  </ChildObjects></Document>
</MetaDataObject>`;
}

function adoptedTableCommandsForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><Table name="РасшифровкаПлатежа" id="25">
    <Representation>List</Representation><DataPath>Объект.РасшифровкаПлатежа</DataPath>
    <AutoCommandBar name="РасшифровкаПлатежаКоманднаяПанель" id="27"><ChildItems>
      <Button name="РасшифровкаПлатежаПодборПоОстаткам" id="167"><CommandName>0</CommandName></Button>
      <Button name="РасшифровкаПлатежаПодобратьПодарочныйСертификат" id="1097"><CommandName>0</CommandName></Button>
      <Button name="РасшифровкаПлатежаПодобратьИзЗаявок" id="385"><CommandName>0</CommandName></Button>
      <Button name="ЗаполнитьОстаткамиНевыданныхСуммКонтрагенту" id="908"><CommandName>0</CommandName></Button>
      <Button name="ЗаполнитьОстаткамиНевыданныхСуммСотруднику" id="910"><CommandName>0</CommandName></Button>
    </ChildItems></AutoCommandBar>
    <ChildItems><InputField name="НомерСтроки" id="30"><DataPath>Объект.РасшифровкаПлатежа.LineNumber</DataPath></InputField></ChildItems>
  </Table></ChildItems>
  <Attributes><Attribute name="Объект"><Type><v8:Type>cfg:DocumentObject.Документ</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
</Form>`;
}

function hiddenPageForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><Pages name="Разделы" id="100"><ChildItems>
    <Page name="Основное" id="101"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Основное</v8:content></v8:item></Title>
      <ChildItems><LabelDecoration name="ОсновноеСодержимое" id="103"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Основное содержимое</v8:content></v8:item></Title></LabelDecoration></ChildItems>
    </Page>
    <Page name="ВалютныйКонтроль" id="102"><Visible>false</Visible><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Валютный контроль</v8:content></v8:item></Title>
      <ChildItems><LabelDecoration name="ВалютныйКонтрольСодержимое" id="104"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Валютный контроль</v8:content></v8:item></Title></LabelDecoration></ChildItems>
    </Page>
  </ChildItems></Pages></ChildItems>
</Form>`;
}

function formattedClearLinkForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><UsualGroup name="ГруппаОснование" id="174">
    <Group>AlwaysHorizontal</Group><Representation>None</Representation><ShowTitle>false</ShowTitle>
    <ChildItems>
      <LabelDecoration name="НадписьОчиститьОснование" id="176"><Title formatted="true">
        <v8:item><v8:lang>ru</v8:lang><v8:content>&lt;link &lt; Очистить&gt;&lt;b&gt;&lt;&lt; Очистить &gt;&gt;&lt;/&gt;&lt;/&gt;</v8:content></v8:item>
      </Title></LabelDecoration>
      <LabelField name="Основание" id="25"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>На основании</v8:content></v8:item></Title></LabelField>
    </ChildItems>
  </UsualGroup></ChildItems>
</Form>`;
}

function styledInheritedButtonsForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <UsualGroup name="Статус" id="20"><Group>Horizontal</Group><ChildItems>
      <Button name="ВРаботе" id="226"><CommandName>0</CommandName><BackColor>style:ДобавленныйРеквизитФон</BackColor></Button>
      <Button name="ВДоставку" id="240"><CommandName>0</CommandName><TextColor>#CCFFFF</TextColor><BackColor>#FF6600</BackColor></Button>
    </ChildItems></UsualGroup>
    <Table name="Товары" id="34"><Representation>List</Representation><DataPath>Объект.Товары</DataPath>
      <AutoCommandBar name="ТоварыКоманднаяПанель" id="36"><ChildItems>
        <Button name="ТоварыОбновитьАктуальныеОстаткиПоСкладу" id="130"><CommandName>0</CommandName></Button>
        <Button name="ТоварыЗаполнитьКолонку" id="270"><CommandName>Form.Command.ЗаполнитьКолонку</CommandName></Button>
        <Button name="ТоварыЗаполнитьЖелаемуюДатуПоставки" id="230"><CommandName>0</CommandName></Button>
        <Button name="ТоварыЗагрузитьДопОписанияИзФайла" id="289"><CommandName>Form.Command.ЗагрузитьДопОписанияИзФайла</CommandName></Button>
      </ChildItems></AutoCommandBar>
      <SearchStringAddition name="ТоварыСтрокаПоиска" id="38"/>
      <ChildItems><InputField name="НомерСтроки" id="30"><DataPath>Объект.Товары.LineNumber</DataPath></InputField></ChildItems>
    </Table>
  </ChildItems>
  <Attributes><Attribute name="Объект"><MainAttribute>true</MainAttribute></Attribute></Attributes>
  <Commands>
    <Command name="ЗаполнитьКолонку"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Заполнить колонку</v8:content></v8:item></Title></Command>
    <Command name="ЗагрузитьДопОписанияИзФайла"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Загрузить доп. описания из файла</v8:content></v8:item></Title></Command>
  </Commands>
</Form>`;
}

function dynamicDateFieldForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
  <ChildItems>
    <InputField name="РасшифровкаБезРазбиенияДатаПогашения" id="1528">
      <ChoiceButton>true</ChoiceButton>
      <ClearButton>true</ClearButton>
      <ChoiceButtonPicture><xr:Ref>StdPicture.InputFieldCalendar</xr:Ref></ChoiceButtonPicture>
    </InputField>
  </ChildItems>
</Form>`;
}

function platformStatePropertiesForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <CheckBoxField name="AnyBoolean" id="701"><TitleLocation>None</TitleLocation>
      <CheckBoxType>Tumbler</CheckBoxType><EditFormat><v8:item><v8:lang>ru</v8:lang>
      <v8:content>БЛ='Первое состояние'; БИ=Второе состояние</v8:content></v8:item></EditFormat>
    </CheckBoxField>
    <LabelDecoration name="AnyWarning" id="702"><TextColor>style:SpecialTextColor</TextColor>
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Предупреждение</v8:content></v8:item></Title>
    </LabelDecoration>
    <UsualGroup name="AnyFold" id="703"><Behavior>Collapsible</Behavior><Collapsed>true</Collapsed>
      <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Раздел</v8:content></v8:item></Title>
      <ChildItems><InputField name="AnyChild" id="704"/></ChildItems>
    </UsualGroup>
  </ChildItems>
</Form>`;
}

function inheritedTitledTableCommandForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <Table name="ЛицевыеСчетаСотрудников" id="756">
      <AutoCommandBar name="ЛицевыеСчетаСотрудниковКоманднаяПанель" id="758">
        <ChildItems>
          <Button name="ЛицевыеСчетаСотрудниковЗаполнитьСтатьюДвиженияДенежныхСредств" id="1521">
            <Type>CommandBarButton</Type>
            <CommandName>0</CommandName>
            <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Заполнить статью ДДС</v8:content></v8:item></Title>
          </Button>
        </ChildItems>
      </AutoCommandBar>
      <ChildItems><InputField name="Сумма" id="778"/></ChildItems>
    </Table>
  </ChildItems>
</Form>`;
}

function adoptedDocumentMeta(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses">
  <Document><Properties><ObjectBelonging>Adopted</ObjectBelonging><Name>Заявка</Name></Properties></Document>
</MetaDataObject>`;
}

function extensionDocumentCommandBarForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <CommandSet>
    <ExcludedCommand>Post</ExcludedCommand>
    <ExcludedCommand>PostAndClose</ExcludedCommand>
    <ExcludedCommand>Write</ExcludedCommand>
  </CommandSet>
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
    <Button name="ФормаПровестиИЗакрыть" id="1"><CommandName>0</CommandName></Button>
    <Button name="ФормаЗаписать" id="2"><CommandName>0</CommandName></Button>
    <Button name="ФормаПровести" id="3"><CommandName>0</CommandName></Button>
  </ChildItems></AutoCommandBar>
  <ChildItems><InputField name="Статус" id="10"/></ChildItems>
  <Attributes><Attribute name="Объект" id="100"><Type><v8:Type>cfg:DocumentObject.Заявка</v8:Type></Type><MainAttribute>true</MainAttribute></Attribute></Attributes>
</Form>`;
}

test('an extension document replaces unresolved standard buttons', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-extension-document-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, extensionDocumentCommandBarForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open({ ...await loader.load(formPath), objectMeta: adoptedDocumentMeta() });
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  // The form's own AutoCommandBar always carries the platform More affordance,
  // empty menu or not, so it is asserted separately from the authored buttons.
  const buttons = page.locator('.fp-body > [data-tag="AutoCommandBar"] .fp-bar-item:not(.fp-more-item) .fp-button');
  assert.equal(await buttons.count(), 3);
  assert.equal(
    await page.locator('.fp-body > [data-tag="AutoCommandBar"] .fp-more-item .fp-button').innerText(),
    'Еще ▾',
  );
  assert.deepEqual(await buttons.evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent?.trim() || '',
    defaultButton: node.classList.contains('fp-button-default'),
    icon: node.querySelector('img')?.getAttribute('src')?.split('/').pop()
      || node.querySelector('use')?.getAttribute('href') || '',
  }))), [
    { text: 'Провести и закрыть', defaultButton: true, icon: '' },
    { text: 'Записать', defaultButton: false, icon: '' },
    { text: 'Провести', defaultButton: false, icon: '' },
  ]);
  assert.deepEqual(await buttons.evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return {
      widths: boxes.map((box) => Math.round(box.width)),
      gaps: boxes.slice(1).map((box, index) => Math.round(box.left - boxes[index].right)),
    };
  }), { widths: [163, 84, 86], gaps: [9, 16] });
  assert.deepEqual(await page.locator('.fp-body > [data-tag="AutoCommandBar"] .fp-commandbar').evaluate((bar) => {
    const barStyle = getComputedStyle(bar);
    const firstStyle = getComputedStyle(bar.querySelector('.fp-button') as Element);
    const secondStyle = getComputedStyle(bar.querySelectorAll('.fp-button')[1] as Element);
    return {
      gap: barStyle.gap,
      overflowX: barStyle.overflowX,
      overflowY: barStyle.overflowY,
      height: firstStyle.height,
      shadow: firstStyle.boxShadow,
      foreground: firstStyle.color,
    secondPadding: `${secondStyle.paddingLeft} ${secondStyle.paddingRight}`,
    firstVerticalPadding: `${firstStyle.paddingTop} ${firstStyle.paddingBottom}`,
    secondVerticalPadding: `${secondStyle.paddingTop} ${secondStyle.paddingBottom}`,
    };
  }), {
    gap: '7px',
    overflowX: 'clip',
    overflowY: 'visible',
    height: '26px',
    shadow: 'rgba(0, 0, 0, 0.176) 0px 1px 0px 0px',
    foreground: 'rgb(77, 77, 77)',
    secondPadding: '10px 12px',
    firstVerticalPadding: '2px 2px',
    secondVerticalPadding: '2px 2px',
  });
});
test('an explicitly titled inherited table command remains on the toolbar', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-inherited-command-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, inheritedTitledTableCommandForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const command = page.locator('[data-id="1521"] .fp-button');
  assert.equal(await command.count(), 1);
  assert.equal((await command.textContent())?.trim(), 'Заполнить статью ДДС');
});

test('a referenced common command renders its metadata title and picture', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-common-command-'));
  const formPath = path.join(tempRoot, 'Documents', 'Order', 'Forms', 'Card', 'Ext', 'Form.xml');
  const objectPath = path.join(tempRoot, 'Documents', 'Order.xml');
  const commandDir = path.join(tempRoot, 'CommonCommands');
  const pictureExt = path.join(tempRoot, 'CommonPictures', 'НавигацияОбновить', 'Ext');
  await fs.mkdir(path.dirname(formPath), { recursive: true });
  await fs.mkdir(commandDir, { recursive: true });
  await fs.mkdir(path.join(pictureExt, 'Picture'), { recursive: true });
  await fs.writeFile(formPath, `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform">
    <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><Autofill>false</Autofill><ChildItems>
      <ButtonGroup name="ФормаГлобальныеКоманды" id="10"><CommandSource>Form</CommandSource></ButtonGroup>
    </ChildItems></AutoCommandBar>
    <CommandInterface><CommandBar><Item><Command>CommonCommand.ПротоколОбмена</Command></Item></CommandBar></CommandInterface>
  </Form>`);
  await fs.writeFile(objectPath, `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses"><Document><Properties><Name>Order</Name></Properties></Document></MetaDataObject>`);
  /* Automatic form commands are listed by the configuration's metadata index. */
  await fs.writeFile(path.join(tempRoot, 'ConfigDumpInfo.xml'),
    '<ConfigDumpInfo><Metadata name="CommonCommand.ПротоколОбмена" id="1"/></ConfigDumpInfo>');
  await fs.writeFile(path.join(commandDir, 'ПротоколОбмена.xml'), `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" xmlns:v8="http://v8.1c.ru/8.1/data/core" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
    <CommonCommand><Properties><Name>ПротоколОбмена</Name>
      <Synonym><v8:item><v8:lang>ru</v8:lang><v8:content>Протокол обмена</v8:content></v8:item></Synonym>
      <Group>FormCommandBarImportant</Group><Representation>PictureAndText</Representation>
      <CommandParameterType><v8:Type>cfg:DocumentRef.Order</v8:Type></CommandParameterType>
      <Picture><xr:Ref>CommonPicture.НавигацияОбновить</xr:Ref></Picture>
    </Properties></CommonCommand></MetaDataObject>`);
  await fs.writeFile(path.join(pictureExt, 'Picture.xml'),
    '<ExtPicture><Picture><xr:Abs>Picture.png</xr:Abs></Picture></ExtPicture>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8zYAAAAAElFTkSuQmCC', 'base64');
  await fs.writeFile(path.join(pictureExt, 'Picture', 'Picture.png'), png);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const button = page.locator('[data-id="_common0_ПротоколОбмена"] .fp-button');
  assert.equal((await button.textContent())?.trim(), 'Протокол обмена');
  assert.equal(await button.locator('img.fp-btn-icon').count(), 1);
  assert.match(await button.locator('img.fp-btn-icon').getAttribute('src') || '', /^data:image\/png;base64,/);
});

test('a page tab renders its declared common picture before the title', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-page-tab-picture-'));
  const formPath = path.join(tempRoot, 'DataProcessors', 'Exchange', 'Forms', 'Main', 'Ext', 'Form.xml');
  const pictureExt = path.join(tempRoot, 'CommonPictures', 'TaxAuthority', 'Ext');
  await fs.mkdir(path.dirname(formPath), { recursive: true });
  await fs.mkdir(path.join(pictureExt, 'Picture'), { recursive: true });
  await fs.writeFile(formPath, `<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable">
    <ChildItems><Pages name="Authorities" id="10"><ChildItems>
      <Page name="Tax" id="11"><Title>Tax service</Title>
        <Picture><xr:Ref>CommonPicture.TaxAuthority</xr:Ref></Picture>
        <ChildItems><LabelDecoration name="TaxContent" id="13"><Title>Tax content</Title></LabelDecoration></ChildItems>
      </Page>
      <Page name="Other" id="12"><Title>Other</Title>
        <ChildItems><LabelDecoration name="OtherContent" id="14"><Title>Other content</Title></LabelDecoration></ChildItems>
      </Page>
    </ChildItems></Pages></ChildItems>
  </Form>`);
  await fs.writeFile(path.join(pictureExt, 'Picture.xml'),
    '<ExtPicture><Picture><xr:Abs>Picture.png</xr:Abs></Picture></ExtPicture>');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8zYAAAAAElFTkSuQmCC', 'base64');
  await fs.writeFile(path.join(pictureExt, 'Picture', 'Picture.png'), png);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const picturedTab = page.locator('.fp-pages-tab').nth(0);
  assert.equal((await picturedTab.locator('.fp-page-tab-title').textContent())?.trim(), 'Tax service');
  assert.equal(await picturedTab.locator('img.fp-page-tab-icon').count(), 1);
  assert.match(await picturedTab.locator('img.fp-page-tab-icon').getAttribute('src') || '', /^data:image\/png;base64,/);
  assert.equal(await page.locator('.fp-pages-tab').nth(1).locator('.fp-page-tab-icon').count(), 0);
});

test('structured runtime affects chrome only for meaningful values', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-structured-runtime-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, structuredRuntimeForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  assert.equal(await page.locator('[data-id="40"] .fp-table-period-active, [data-id="40"] .fp-table-filter-active').count(), 0);
  assert.equal(await page.locator('[data-id="50"] .fp-table-period-active.fp-table-filter-active').count(), 1);
  assert.equal(await page.locator('[data-id="50"] .fp-table-mock').getAttribute('data-row-filter'), 'active');
  const choice = page.locator('[data-id="20"] .fp-choice-button');
  assert.deepEqual(JSON.parse(await choice.getAttribute('data-choice-parameter-links') || '[]'),
    [{ name: 'Company', mode: 'Clear', dataPath: 'Object.Company' }]);
  assert.deepEqual(JSON.parse(await choice.getAttribute('data-choice-parameters') || '[]'),
    [{ name: 'Filter.Owner', value: 'Main', type: 'xs:string' }]);
  assert.equal(await page.locator('[data-id="20"] .fp-input-wrap').evaluate((node) =>
    getComputedStyle(node).borderStyle), 'none');
  assert.equal(await page.locator('[data-id="30"] .fp-back-picture[data-picture-ref="CommonPicture.Background"]').count(), 1);
  assert.equal(await page.locator('[data-id="40"] .fp-footer-picture').count(), 1);
  const createPopup = page.locator('[data-id="10"] .fp-button');
  assert.equal((await createPopup.textContent())?.trim(), 'Create based on▾');
  assert.equal(await createPopup.locator('.fp-btn-icon').count(), 1);
});

test('a dynamic date field uses its declared picture without shortening by name', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-dynamic-date-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, dynamicDateFieldForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const field = page.locator('[data-id="1528"]');
  assert.equal(await field.locator('.fp-field-label').textContent(), 'Расшифровка без разбиения дата погашения:');
  assert.deepEqual(await field.locator('.fp-input-btn use').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('href'))), ['#i-calendar', '#i-x']);
});

test('platform tumbler format, special text and designer fold state are generic', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-platform-state-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, platformStatePropertiesForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  assert.deepEqual(await page.locator('[data-id="701"] .fp-segmented-item').allTextContents(),
    ['Второе состояние', 'Первое состояние']);
  assert.equal(await page.locator('[data-id="702"]').evaluate((node) => getComputedStyle(node).color),
    'rgb(255, 0, 0)');
  assert.equal(await page.locator('[data-id="703"] .fp-collapsible-title').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('[data-id="704"]').isVisible(), true);
});

test('zero-width AutoMaxWidth=false field fills the viewport through a wrapper group', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-zero-width-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, zeroWidthStretchForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const widths = await page.evaluate(() => ({
    body: document.querySelector('.fp-body')?.getBoundingClientRect().width || 0,
    group: document.querySelector('[data-id="10"]')?.getBoundingClientRect().width || 0,
    input: document.querySelector('[data-id="11"] .fp-input-wrap')?.getBoundingClientRect().width || 0,
  }));
  assert.ok(widths.group > widths.body * 0.9, JSON.stringify(widths));
  assert.ok(widths.input > widths.body * 0.65, JSON.stringify(widths));
});

test('vertical stretch does not push a horizontal footer label into the middle', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-horizontal-footer-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, horizontalFooterForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1000, height: 480 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open({ ...await loader.load(formPath), objectMeta: responsibleObjectMeta() });
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const boxes = await page.evaluate(() => {
    const bodyBox = document.querySelector('.fp-body')?.getBoundingClientRect();
    const labelBox = document.querySelector('[data-id="784"]')?.getBoundingClientRect();
    const commentBox = document.querySelector('[data-id="179"] .fp-input-wrap')?.getBoundingClientRect();
    const responsibleBox = document.querySelector('[data-id="779"]')?.getBoundingClientRect();
    return {
      body: bodyBox ? { left: bodyBox.left, right: bodyBox.right, width: bodyBox.width } : null,
      label: labelBox ? { left: labelBox.left, right: labelBox.right, width: labelBox.width } : null,
      comment: commentBox
        ? { left: commentBox.left, right: commentBox.right, width: commentBox.width, height: commentBox.height }
        : null,
      responsible: responsibleBox
        ? {
          left: responsibleBox.left,
          right: responsibleBox.right,
          width: responsibleBox.width,
          alignedRight: document.querySelector('[data-id="779"]')?.classList.contains('fp-align-right') || false,
        }
        : null,
    };
  });
  assert.ok(boxes.body && boxes.label && boxes.comment && boxes.responsible, JSON.stringify(boxes));
  assert.ok(boxes.label.left - boxes.body.left <= 12, JSON.stringify(boxes));
  assert.ok(boxes.label.width < 100, JSON.stringify(boxes));
  assert.ok(boxes.comment.left >= boxes.label.right, JSON.stringify(boxes));
  assert.ok(boxes.comment.width > 400, JSON.stringify(boxes));
  assert.ok(boxes.comment.height < 40, JSON.stringify(boxes));
  assert.ok(boxes.responsible.width > 450, JSON.stringify(boxes));
  assert.equal(boxes.responsible.alignedRight, true, JSON.stringify(boxes));
  assert.ok(boxes.responsible.left >= boxes.comment.right, JSON.stringify(boxes));
  assert.ok(boxes.body.right - boxes.responsible.right < 12, JSON.stringify(boxes));
});

test('explicit decoration and title-less field rows share one label column', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-explicit-label-rows-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><UsualGroup name="Rows" id="1"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
    <UsualGroup name="ShortRow" id="2"><Width>18</Width><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
      <LabelDecoration name="ShortTitle" id="3"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Номер:</v8:content></v8:item></Title></LabelDecoration>
      <InputField name="ShortValue" id="4"><TitleLocation>None</TitleLocation><Width>20</Width></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="LongRow" id="5"><Width>18</Width><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
      <LabelDecoration name="LongTitle" id="6"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Основания осуществления расчетов:</v8:content></v8:item></Title></LabelDecoration>
      <InputField name="LongValue" id="7"><TitleLocation>None</TitleLocation><Width>20</Width><ToolTipRepresentation>Button</ToolTipRepresentation><ToolTip><v8:item><v8:lang>ru</v8:lang><v8:content>Подсказка</v8:content></v8:item></ToolTip></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="DateRow" id="8"><Width>18</Width><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
      <LabelDecoration name="DateTitle" id="9"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Дата:</v8:content></v8:item></Title></LabelDecoration>
      <InputField name="DateValue" id="10"><TitleLocation>None</TitleLocation><Width>8</Width><ChoiceButtonPicture>StdPicture.InputFieldCalendar</ChoiceButtonPicture></InputField>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup></ChildItems>
</Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 800, height: 400 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const left = await page.locator('[data-id="4"] .fp-input-wrap').boundingBox();
  const right = await page.locator('[data-id="7"] .fp-input-wrap').boundingBox();
  const date = await page.locator('[data-id="10"] .fp-input-wrap').boundingBox();
  assert.ok(left && right && date);
  assert.ok(Math.abs(left.x - right.x) < 1, JSON.stringify({ left, right }));
  assert.ok(Math.abs(left.x - date.x) < 1, JSON.stringify({ left, date }));
  assert.ok(left.width > 400, JSON.stringify({ left }));
  assert.ok(date.width < 100, JSON.stringify({ date }));
  const body = await page.locator('.fp-body').boundingBox();
  const tooltipLink = page.locator('[data-id="7"] .fp-tooltip-link');
  const tooltip = await tooltipLink.boundingBox();
  assert.ok(body && tooltip && tooltip.x + tooltip.width <= body.x + body.width,
    JSON.stringify({ body, tooltip }));
  assert.deepEqual(await tooltipLink.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      tagName: node.tagName,
      text: node.textContent,
      title: node.getAttribute('title'),
      color: style.color,
      borderWidth: style.borderTopWidth,
      backgroundColor: style.backgroundColor,
      textDecorationLine: style.textDecorationLine
    };
  }), {
    tagName: 'SPAN',
    text: '?',
    title: 'Подсказка',
    color: 'rgb(0, 113, 188)',
    borderWidth: '0px',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    textDecorationLine: 'none'
  });
});

test('a tooltip link reserves space beside a fixed field in a narrow group', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-tooltip-link-space-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><UsualGroup name="Narrow" id="1"><Width>5</Width><HorizontalStretch>false</HorizontalStretch><Group>Vertical</Group><Representation>None</Representation><ChildItems>
    <InputField name="Fixed" id="2"><TitleLocation>None</TitleLocation><Width>6</Width><HorizontalStretch>false</HorizontalStretch><ToolTipRepresentation>Button</ToolTipRepresentation><ToolTip><v8:item><v8:lang>ru</v8:lang><v8:content>Подсказка</v8:content></v8:item></ToolTip></InputField>
  </ChildItems></UsualGroup></ChildItems>
</Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 200, height: 160 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const geometry = await page.locator('[data-id="2"]').evaluate((item) => {
    const field = (item.querySelector('.fp-input-wrap') as HTMLElement).getBoundingClientRect();
    const link = (item.querySelector('.fp-tooltip-link') as HTMLElement).getBoundingClientRect();
    const row = item.getBoundingClientRect();
    return {
      className: item.className,
      width: getComputedStyle(item).width,
      minWidth: getComputedStyle(item).minWidth,
      maxWidth: getComputedStyle(item).maxWidth,
      fieldRight: field.right,
      linkLeft: link.left,
      linkRight: link.right,
      rowRight: row.right,
      overlap: Math.max(0, field.right - link.left)
    };
  });
  assert.equal(geometry.overlap, 0, JSON.stringify(geometry));
  assert.ok(geometry.linkLeft - geometry.fieldRight >= 6, JSON.stringify(geometry));
  assert.ok(geometry.rowRight >= geometry.linkRight, JSON.stringify(geometry));
});

test('warning decoration before a button group does not widen a field title', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-warning-label-row-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><UsualGroup name="Authorization" id="1"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
    <UsualGroup name="DateNumber" id="2"><Group>Horizontal</Group><Representation>None</Representation><ChildItems>
      <InputField name="Date" id="3"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Дата</v8:content></v8:item></Title><Width>13</Width></InputField>
      <InputField name="Number" id="4"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Номер</v8:content></v8:item></Title><Width>16</Width></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="Warning" id="5"><Group>Horizontal</Group><Representation>None</Representation><ChildItems>
      <PictureDecoration name="WarningPicture" id="6"/>
      <LabelDecoration name="WarningText" id="7"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Требуется доначисление или перерасчет зарплаты</v8:content></v8:item></Title></LabelDecoration>
      <UsualGroup name="WarningActions" id="8"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
        <Button name="Recalculate" id="9"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Пересчитать</v8:content></v8:item></Title></Button>
      </ChildItems></UsualGroup>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup></ChildItems>
</Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1000, height: 360 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const dateLabel = await page.locator('[data-id="3"] .fp-field-label').boundingBox();
  const dateField = await page.locator('[data-id="3"] .fp-input-wrap').boundingBox();
  const warningLabel = await page.locator('[data-id="7"] .fp-label').boundingBox();
  assert.ok(dateLabel && dateField && warningLabel);
  assert.ok(dateLabel.width < 80, JSON.stringify({ dateLabel, warningLabel }));
  assert.ok(dateField.x - (dateLabel.x + dateLabel.width) < 16,
    JSON.stringify({ dateLabel, dateField }));
  assert.ok(warningLabel.width > dateLabel.width * 3,
    JSON.stringify({ dateLabel, warningLabel }));
});

test('explicit group dimensions form a fixed row of equally stretched cards', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-sized-groups-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems>
    <UsualGroup name="Header" id="1"><Height>3</Height><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><BackColor>#FBED9E</BackColor><ChildItems><LabelDecoration name="HeaderText" id="2"><Height>2</Height><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Шапка</v8:content></v8:item></Title></LabelDecoration></ChildItems></UsualGroup>
    <UsualGroup name="CardRow" id="3"><Width>67</Width><Height>12</Height><HorizontalStretch>false</HorizontalStretch><VerticalStretch>false</VerticalStretch><Representation>None</Representation><ChildItems>
      <UsualGroup name="FirstCard" id="4"><Width>32</Width><Height>8</Height><HorizontalStretch>true</HorizontalStretch><VerticalStretch>true</VerticalStretch><Group>Vertical</Group><Representation>NormalSeparation</Representation><BackColor>#FFFBE3</BackColor><ChildItems><LabelDecoration name="FirstText" id="5"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Первая</v8:content></v8:item></Title></LabelDecoration><Button name="BottomAction" id="8"><GroupVerticalAlign>Bottom</GroupVerticalAlign><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Действие</v8:content></v8:item></Title></Button></ChildItems></UsualGroup>
      <UsualGroup name="SecondCard" id="6"><Width>32</Width><Height>8</Height><HorizontalStretch>true</HorizontalStretch><VerticalStretch>true</VerticalStretch><Group>Vertical</Group><Representation>NormalSeparation</Representation><BackColor>#FFFBE3</BackColor><ChildItems><LabelDecoration name="SecondText" id="7"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Вторая</v8:content></v8:item></Title></LabelDecoration></ChildItems></UsualGroup>
    </ChildItems></UsualGroup>
  </ChildItems>
</Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 420 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const header = await page.locator('[data-id="1"]').boundingBox();
  const headerText = await page.locator('[data-id="2"]').boundingBox();
  const row = await page.locator('[data-id="3"]').boundingBox();
  const first = await page.locator('[data-id="4"]').boundingBox();
  const second = await page.locator('[data-id="6"]').boundingBox();
  const bottomAction = await page.locator('[data-id="8"]').boundingBox();
  assert.ok(header && headerText && row && first && second && bottomAction);
  assert.ok(Math.abs(header.height - 48) < 1, JSON.stringify({ header }));
  assert.ok(Math.abs(headerText.height - 36) < 1, JSON.stringify({ headerText }));
  assert.ok(Math.abs(row.width - 670) < 1 && Math.abs(row.height - 192) < 1, JSON.stringify({ row }));
  assert.ok(Math.abs(first.width - second.width) < 1, JSON.stringify({ first, second }));
  assert.ok(Math.abs(first.height - row.height) < 1 && Math.abs(second.height - row.height) < 1,
    JSON.stringify({ row, first, second }));
  assert.ok(first.y + first.height - (bottomAction.y + bottomAction.height) < 10,
    JSON.stringify({ first, bottomAction }));
  assert.equal(await page.locator('[data-id="4"]').evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgb(255, 251, 227)');
});

test('report status bands keep literal labels and sheet leaves footer visible', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-report-sheet-footer-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, reportSheetWithStatusBandsForm());
  await fs.mkdir(path.join(tempRoot, 'StyleItems'));
  await fs.writeFile(path.join(tempRoot, 'StyleItems', 'ЦветФонаУдачнойОтправки.xml'), '<Value>#D7F0C7</Value>');
  await fs.writeFile(path.join(tempRoot, 'StyleItems', 'ЦветФонаОшибкиОтправки.xml'), '<Value>#FBD4D4</Value>');
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 820, height: 465 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const state = await page.evaluate(() => {
    const success = document.querySelector('[data-id="10"]') as HTMLElement | null;
    const error = document.querySelector('[data-id="20"]') as HTMLElement | null;
    const footer = document.querySelector('[data-id="40"]')?.getBoundingClientRect();
    const sheet = document.querySelector('[data-id="33"]')?.getBoundingClientRect();
    return {
      stage: document.querySelector('[data-id="11"]')?.textContent?.trim() || '',
      protocol: document.querySelector('[data-id="12"]')?.textContent?.trim() || '',
      successColor: success ? getComputedStyle(success).backgroundColor : '',
      errorColor: error ? getComputedStyle(error).backgroundColor : '',
      footerBottom: footer?.bottom || 0,
      sheetBottom: sheet?.bottom || 0,
      viewportHeight: innerHeight,
    };
  });
  assert.equal(state.stage, '<Наименование этапа>');
  assert.equal(state.protocol, '<Протокол>');
  assert.equal(state.successColor, 'rgb(215, 240, 199)');
  assert.equal(state.errorColor, 'rgb(251, 212, 212)');
  assert.ok(state.sheetBottom <= state.footerBottom, JSON.stringify(state));
  assert.ok(state.footerBottom <= state.viewportHeight, JSON.stringify(state));
});

test('a table stretches through PagesRepresentation=None like the platform layout', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-hidden-pages-table-stretch-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, hiddenPagesVerticalTableForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 483, height: 408 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const state = await page.evaluate(() => {
    const body = document.querySelector('.fp-body')?.getBoundingClientRect();
    const pages = document.querySelector('[data-id="10"]')?.getBoundingClientRect();
    const table = document.querySelector('[data-id="12"]')?.getBoundingClientRect();
    return {
      body: body && { top: body.top, bottom: body.bottom, height: body.height },
      pages: pages && { top: pages.top, bottom: pages.bottom, height: pages.height },
      table: table && { top: table.top, bottom: table.bottom, height: table.height },
    };
  });
  assert.ok(state.body && state.pages && state.table, JSON.stringify(state));
  assert.ok(state.pages.height > 250, JSON.stringify(state));
  assert.ok(state.pages.height - state.table.height < 8, JSON.stringify(state));
  assert.ok(Math.abs(state.table.bottom - state.body.bottom) < 12, JSON.stringify(state));
});

test('an adopted document table does not invent unresolved inherited commands', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-adopted-table-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, adoptedTableCommandsForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1000, height: 480 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open({ ...await loader.load(formPath), objectMeta: adoptedDocumentMeta() });
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const buttons = await page.locator('[data-id="25"] .fp-table-toolbar .fp-button').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: node.textContent?.trim() || '',
      icon: node.querySelector('use')?.getAttribute('href') || '',
    })),
  );
  assert.deepEqual(buttons.slice(0, 3), [
    { text: 'Добавить', icon: '' },
    { text: 'Переместить вверх', icon: '' },
    { text: 'Переместить вниз', icon: '' },
  ]);
  assert.equal(buttons.some((button) => /Подобрать|Заполнить/.test(button.text)), false);
});

test('a Visible=false page stays out of runtime tabs but remains inspectable from the outline', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-hidden-page-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, hiddenPageForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const tabs = page.locator('.fp-pages-tab');
  assert.equal(await tabs.count(), 1);
  assert.equal(await tabs.nth(0).getAttribute('data-visible'), null);
  await browser.selectElement('102');
  assert.equal(await tabs.count(), 2);
  assert.equal(await tabs.nth(1).getAttribute('data-visible'), 'false');
  assert.equal(await tabs.nth(1).getAttribute('title'), 'Видимость: Ложь');
  assert.equal(await tabs.nth(1).evaluate((tab) => tab.classList.contains('fp-page-hidden')), true);
  const style = await tabs.nth(1).evaluate((tab) => {
    const css = getComputedStyle(tab);
    return { backgroundImage: css.backgroundImage, color: css.color };
  });
  assert.match(style.backgroundImage, /repeating-linear-gradient/i);
  assert.equal(style.color, 'rgb(102, 102, 102)');
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true');
});

test('every managed form keeps the configurator blue title strip', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-title-strip-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  const form = (showTitle: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <Title><v8:item><v8:lang>ru</v8:lang><v8:content>Тестовая форма</v8:content></v8:item></Title>
  ${showTitle ? '' : '<ShowTitle>false</ShowTitle>'}
  <ChildItems><InputField name="Поле" id="301"/></ChildItems>
</Form>`;
  await fs.writeFile(formPath, form(true));
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const strip = page.locator('.fp-form-title');
  assert.equal(await strip.count(), 1);
  assert.equal((await strip.textContent())?.trim(), 'Тестовая форма');
  const appearance = await strip.evaluate((node) => {
    const style = getComputedStyle(node);
    return { height: node.getBoundingClientRect().height, background: style.backgroundColor };
  });
  assert.deepEqual(appearance, { height: 23, background: 'rgb(191, 205, 219)' });

  await fs.writeFile(formPath, form(false));
  await browser.open(await loader.load(formPath));
  assert.equal(await page.locator('.fp-form-title').count(), 1);
  assert.equal((await page.locator('.fp-form-title').textContent())?.trim(), '');
});

test('configured button colours come from StyleItems and unresolved commands are not guessed', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-styled-buttons-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, styledInheritedButtonsForm());
  await fs.mkdir(path.join(tempRoot, 'StyleItems'));
  await fs.writeFile(path.join(tempRoot, 'StyleItems', 'ДобавленныйРеквизитФон.xml'), '<Value>#CCFFCC</Value>');
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 500 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open({ ...await loader.load(formPath), objectMeta: adoptedDocumentMeta() });
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const visual = await page.evaluate(() => Object.fromEntries(['226', '240'].map((id) => {
    const button = document.querySelector(`[data-id="${id}"] .fp-button`) as HTMLElement | null;
    const css = button && getComputedStyle(button);
    return [id, button && css ? {
      text: button.textContent?.trim(),
      icon: button.querySelector('use')?.getAttribute('href'),
      color: css.color,
      backgroundImage: css.backgroundImage,
    } : null];
  })));
  assert.deepEqual(visual['226'], {
    text: 'В работе', icon: undefined, color: 'rgb(77, 77, 77)',
    backgroundImage: 'linear-gradient(rgb(211, 255, 211) 0%, rgb(204, 255, 204) 46%, rgb(194, 242, 194) 100%)',
  });
  assert.deepEqual(visual['240'], {
    text: 'В доставку', icon: undefined, color: 'rgb(204, 255, 255)',
    backgroundImage: 'linear-gradient(rgb(255, 122, 34) 0%, rgb(255, 102, 0) 46%, rgb(242, 97, 0) 100%)',
  });

  const toolbar = page.locator('[data-id="34"] .fp-table-toolbar');
  const toolbarButtons = await toolbar.locator('.fp-button').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent?.trim() || '',
    icon: node.querySelector('use')?.getAttribute('href') || '',
  })));
  assert.equal(toolbarButtons.some((button) => /Остатки на складе|желаемую дату/.test(button.text)), false);
  assert.equal(toolbarButtons.some((button) => button.text === 'Заполнить колонку'), true);
  assert.notEqual(await toolbar.locator('.fp-search-item').evaluate((node) => getComputedStyle(node).display), 'none');
});

test('formatted clear decoration renders its escaped angle brackets as a link', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-formatted-clear-link-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, formattedClearLinkForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession(options(tempRoot));
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const link = page.locator('[data-id="176"] .fp-rich-link');
  assert.equal(await link.textContent(), '< Очистить >');
  assert.equal(await link.evaluate((node) => getComputedStyle(node).textDecorationLine), 'underline');
  assert.equal(await page.locator('[data-id="25"] .fp-field-label').textContent(), 'На основании:');
});

test('an empty autofill-false table command bar has no rendered toolbar row', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-empty-table-bar-'));
  const formPath = path.join(root, 'Form.xml');
  await fs.writeFile(formPath, emptyManualTableBarForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  assert.equal(await page.locator('[data-id="15"] .fp-table-toolbar').count(), 0);
  assert.equal(await page.locator('[data-id="15"] .fp-search-item').count(), 0);
  assert.equal(await page.locator('[data-id="15"] .fp-more-item').count(), 0);
});

test('form command bar overflows into More and ordinary unlimited fields stay compact', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-responsive-commandbar-'));
  const formPath = path.join(root, 'Form.xml');
  const buttons = Array.from({ length: 9 }, (_, index) =>
    `<Button name="Command${index}" id="${100 + index}"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Long command ${index}</v8:content></v8:item></Title></Button>`,
  ).join('');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <AutoCommandBar name="Bar" id="-1"><Autofill>false</Autofill><ChildItems>${buttons}
    <Button name="OnlyUndo" id="190"><CommandName>Form.StandardCommand.UndoPosting</CommandName></Button>
    <Button name="Help" id="191"><Title>?</Title><CommandName>Form.StandardCommand.Help</CommandName><Representation>Picture</Representation></Button>
  </ChildItems></AutoCommandBar>
  <ChildItems><InputField name="Order" id="10"><DataPath>Order</DataPath><TitleLocation>None</TitleLocation></InputField></ChildItems>
  <Attributes><Attribute name="Order" id="1"><Type><v8:Type>xs:string</v8:Type><v8:StringQualifiers><v8:Length>0</v8:Length><v8:AllowedLength>Variable</v8:AllowedLength></v8:StringQualifiers></Type></Attribute></Attributes>
</Form>`);
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession({ ...options(root), viewport: { width: 620, height: 320 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  await page.waitForFunction(() => document.querySelectorAll('.fp-bar-overflow-hidden').length > 0);
  const bar = page.locator('.fp-commandbar');
  const stripBounds = await page.locator('.fp-form-title').boundingBox();
  const firstButtonBounds = await bar.locator('[data-id="100"] .fp-button').boundingBox();
  const previewBounds = await page.locator('#preview').boundingBox();
  assert.ok(stripBounds && firstButtonBounds && previewBounds);
  assert.ok(Math.abs(firstButtonBounds.y - stripBounds.y - stripBounds.height - 3) <= 1);
  assert.ok(Math.abs(firstButtonBounds.x - previewBounds.x - 12) <= 1);
  assert.equal(await bar.locator('[data-id="190"]').count(), 0,
    'UndoPosting is unavailable in the default unposted preview state');
  assert.ok(await bar.locator('.fp-bar-overflow-hidden').count() > 0);
  assert.equal(await bar.locator('.fp-more-item').count(), 1);
  assert.notEqual(await bar.locator('.fp-help-item').evaluate((node) => getComputedStyle(node).display), 'none');
  assert.equal(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
  await bar.locator('.fp-more-item .fp-button').click();
  const overflowMenu = page.locator('body > .fp-popup-menu');
  await overflowMenu.waitFor({ state: 'visible' });
  const overflowTitles = await overflowMenu.locator('.fp-popup-entry').allTextContents();
  assert.ok(overflowTitles.some((title) => title.trim() === 'Long command 8'), JSON.stringify(overflowTitles));
  assert.ok((await page.locator('[data-id="10"]').boundingBox())!.height < 40);
});

test('a wide Page keeps overflow local without widening an independent root header', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-page-local-overflow-'));
  const formPath = path.join(root, 'Form.xml');
  await fs.writeFile(formPath, pageLocalOverflowWithRootHeaderForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession({ ...options(root), viewport: { width: 420, height: 360 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForFunction(() => document.querySelector('.fp-pages-active-panel')
    ?.classList.contains('fp-window-overflow'));
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const header = document.querySelector('[data-id="10"]') as HTMLElement;
    const switcher = document.querySelector('[data-id="11"]') as HTMLElement;
    const panel = document.querySelector('.fp-pages-active-panel') as HTMLElement;
    const bodyBox = body.getBoundingClientRect();
    const headerBox = header.getBoundingClientRect();
    const switcherBox = switcher.getBoundingClientRect();
    return {
      bodyOwnsOverflow: body.classList.contains('fp-window-overflow'),
      bodyWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      headerWidth: headerBox.width,
      headerRight: headerBox.right - bodyBox.left,
      switcherRight: switcherBox.right - bodyBox.left,
      panelWidth: panel.clientWidth,
      panelScrollWidth: panel.scrollWidth,
      panelOwnsOverflow: panel.classList.contains('fp-window-overflow'),
    };
  });
  assert.equal(geometry.bodyOwnsOverflow, false, JSON.stringify(geometry));
  assert.ok(geometry.bodyScrollWidth <= geometry.bodyWidth + 1, JSON.stringify(geometry));
  assert.ok(geometry.headerWidth <= geometry.bodyWidth + 1, JSON.stringify(geometry));
  assert.ok(geometry.headerRight <= geometry.bodyWidth + 1, JSON.stringify(geometry));
  assert.ok(Math.abs(geometry.switcherRight - geometry.bodyWidth) <= 12, JSON.stringify(geometry));
  assert.equal(geometry.panelOwnsOverflow, true, JSON.stringify(geometry));
  // With visible scrollbars the Page's own vertical lane narrows its client box.
  assert.ok(geometry.panelScrollWidth > geometry.panelWidth + 60, JSON.stringify(geometry));
});

test('command-dense table keeps SearchStringAddition visible while commands overflow into More', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-table-search-overflow-'));
  const formPath = path.join(root, 'Form.xml');
  const buttons = Array.from({ length: 9 }, (_, index) =>
    `<Button name="TableCommand${index}" id="${200 + index}"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Table command ${index}</v8:content></v8:item></Title></Button>`,
  ).join('');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <ChildItems><Table name="Rows" id="20"><Height>5</Height>
    <AutoCommandBar name="RowsBar" id="21"><Autofill>false</Autofill><ChildItems>${buttons}</ChildItems></AutoCommandBar>
    <SearchStringAddition name="RowsSearch" id="22"/>
    <ChildItems><InputField name="Name" id="23"><Title>Name</Title></InputField></ChildItems>
  </Table></ChildItems>
</Form>`);
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession({ ...options(root), viewport: { width: 760, height: 360 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const bar = page.locator('[data-id="20"] .fp-table-toolbar');
  await page.waitForFunction(() => document.querySelectorAll('.fp-table-toolbar .fp-bar-overflow-hidden').length > 0);
  assert.notEqual(await bar.locator('.fp-search-item').evaluate((node) => getComputedStyle(node).display), 'none');
  assert.equal(await bar.locator('.fp-search-item.fp-bar-overflow-hidden').count(), 0);
  assert.equal(await bar.locator('.fp-search-item').evaluate((node) => node.getBoundingClientRect().width), 200);
  assert.equal(await bar.locator('.fp-more-item').count(), 1);
  assert.equal(await bar.evaluate((node) => node.scrollWidth <= node.clientWidth + 4), true);
  await page.setViewportSize({ width: 1800, height: 360 });
  await page.waitForFunction(() => document.querySelector('.fp-search-item')?.getBoundingClientRect().width === 260);
  assert.equal(await bar.locator('.fp-search-item').evaluate((node) => node.getBoundingClientRect().width), 260);
  await page.setViewportSize({ width: 760, height: 360 });
  await page.waitForFunction(() => document.querySelector('.fp-search-item')?.getBoundingClientRect().width === 200);
  assert.equal(await bar.locator('.fp-search-item.fp-bar-overflow-hidden').count(), 0);
});

test('cross-axis wrapper stretch keeps a horizontal totals footer compact', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-compact-totals-footer-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, compactTotalsFooterForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1000, height: 600 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const body = await page.locator('.fp-body').boundingBox();
  const footer = await page.locator('[data-id="920"]').boundingBox();
  const totalsRow = await page.locator('[data-id="922"]').boundingBox();
  const amount = await page.locator('[data-id="924"]').boundingBox();
  assert.ok(body && footer && totalsRow && amount);
  const geometry = { body, footer, totalsRow, amount };
  assert.ok(footer.height < 100, JSON.stringify(geometry));
  assert.ok(totalsRow.height < 60, JSON.stringify(geometry));
  assert.ok(body.y + body.height - (footer.y + footer.height) < 24, JSON.stringify(geometry));
});

test('constrained header fields stay inside the form while the table scrolls locally', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-constrained-header-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, constrainedHeaderForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 960, height: 650 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const header = document.querySelector('[data-id="930"]') as HTMLElement;
    const comment = document.querySelector('[data-id="970"]') as HTMLElement;
    const statusInput = document.querySelector('[data-id="938"] .fp-input-wrap') as HTMLElement;
    const tableScroll = document.querySelector('[data-id="945"] .fp-table-mock') as HTMLElement;
    return {
      bodyClient: body.clientWidth, bodyScroll: body.scrollWidth,
      headerRight: header.getBoundingClientRect().right,
      commentRight: comment.getBoundingClientRect().right,
      bodyRight: body.getBoundingClientRect().right,
      statusWidth: statusInput.getBoundingClientRect().width,
      tableClient: tableScroll.clientWidth, tableScroll: tableScroll.scrollWidth,
    };
  });
  assert.ok(geometry.bodyScroll <= geometry.bodyClient + 1, JSON.stringify(geometry));
  assert.ok(geometry.headerRight <= geometry.bodyRight + 1, JSON.stringify(geometry));
  assert.ok(geometry.commentRight <= geometry.bodyRight + 1, JSON.stringify(geometry));
  assert.ok(geometry.statusWidth < 31 * 8, JSON.stringify(geometry));
  assert.ok(geometry.tableScroll > geometry.tableClient, JSON.stringify(geometry));
});

test('a narrow form scrolls horizontally instead of painting sibling fields over each other', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-no-field-overlap-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="CustomerRow" id="100"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
    <InputField name="Customer" id="101"><Width>24</Width><HorizontalStretch>true</HorizontalStretch><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Клиент:</v8:content></v8:item></Title></InputField>
    <InputField name="Organization" id="102"><Width>24</Width><HorizontalStretch>true</HorizontalStretch><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Организация:</v8:content></v8:item></Title></InputField>
    <LabelDecoration name="Restriction" id="103"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Отгрузка клиенту запрещена</v8:content></v8:item></Title><Hyperlink>true</Hyperlink></LabelDecoration>
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 420, height: 260 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const row = document.querySelector('[data-id="100"] .fp-children-horizontal') as HTMLElement;
    const items = Array.from(row.children).filter((node) => (node as HTMLElement).classList.contains('fp-item')) as HTMLElement[];
    const pairs: Array<{ paintedRight: number; nextLeft: number }> = [];
    for (let index = 0; index + 1 < items.length; index++) {
      let paintedRight = items[index].getBoundingClientRect().right;
      const descendants = items[index].querySelectorAll<HTMLElement>(
        '.fp-field-row, .fp-field-label, .fp-input-wrap, .fp-label',
      );
      for (let childIndex = 0; childIndex < descendants.length; childIndex++) {
        const style = getComputedStyle(descendants[childIndex]);
        if (style.display !== 'none' && style.visibility !== 'hidden')
          paintedRight = Math.max(paintedRight, descendants[childIndex].getBoundingClientRect().right);
      }
      pairs.push({ paintedRight, nextLeft: items[index + 1].getBoundingClientRect().left });
    }
    return {
      bodyClient: body.clientWidth,
      bodyScroll: body.scrollWidth,
      overflowX: getComputedStyle(body).overflowX,
      rowMinWidth: row.style.minWidth,
      pairs,
    };
  });
  assert.equal(geometry.overflowX, 'auto', JSON.stringify(geometry));
  assert.ok(geometry.bodyScroll > geometry.bodyClient + 1, JSON.stringify(geometry));
  // A flex row may already preserve sibling separation without needing the
  // older explicit min-width marker (with the window scrollbar lane reserved
  // this row no longer sets one). The observable contract is the scrollable
  // canvas plus collision-free painted rectangles, asserted above and below.
  assert.ok(geometry.pairs.every((pair) => pair.paintedRight <= pair.nextLeft + 1), JSON.stringify(geometry));

  await page.setViewportSize({ width: 1000, height: 260 });
  await page.waitForFunction(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const row = document.querySelector('[data-id="100"] .fp-children-horizontal') as HTMLElement;
    return body.scrollWidth <= body.clientWidth + 1 && row.style.minWidth === '';
  });
});

test('an empty stretching decoration pushes a footer amount to the right', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-right-total-footer-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, rightAlignedAmountFooterForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 960, height: 300 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const geometry = await page.evaluate(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const spacer = document.querySelector('[data-id="981"]') as HTMLElement;
    const amount = document.querySelector('[data-id="982"]') as HTMLElement;
    const bodyBox = body.getBoundingClientRect();
    const amountBox = amount.getBoundingClientRect();
    return {
      bodyLeft: bodyBox.left, bodyRight: bodyBox.right,
      spacerWidth: spacer.getBoundingClientRect().width,
      amountLeft: amountBox.left, amountRight: amountBox.right,
    };
  });
  assert.ok(geometry.spacerWidth > 300, JSON.stringify(geometry));
  assert.ok(geometry.amountLeft > (geometry.bodyLeft + geometry.bodyRight) / 2, JSON.stringify(geometry));
  // Root content ends in the platform's 20px window scrollbar lane.
  assert.ok(geometry.bodyRight - geometry.amountRight <= 21, JSON.stringify(geometry));
});

test('one Edge page handles nested tabs, hidden selection, scrolling and reload', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-browser-'));
  const formPath = path.join(root, 'Nested.xml');
  await fs.writeFile(formPath, nestedForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  const controller = new ViewerController(loader, browser);
  t.after(async () => {
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const { payload: opened } = await controller.open(formPath);
  assert.equal(opened.state.format, 'form');
  assert.equal(opened.state.tabs.find((tab) => tab.pageId === '101')?.active, true);
  const context = (browser as unknown as { context: { newPage: () => Promise<any> } }).context;
  const internalPage = await context.newPage();
  let annotations: Array<{ id: string; elementId: string; elementName: string; text: string }> = [];
  let deletedAnnotationId = '';
  await internalPage.route('**/state.json', async (route: any) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), annotations } });
  });
  await internalPage.route(/\/annotations(?:\/.*)?$/, async (route: any) => {
    const request = route.request();
    if (request.method() === 'PATCH') {
      const id = new URL(request.url()).pathname.split('/').pop();
      const value = request.postDataJSON();
      if (value.text === 'Ошибка') {
        await route.fulfill({ status: 409, body: 'Revision changed' });
        return;
      }
      const annotation = annotations.find((item) => item.id === id)!;
      annotation.text = value.text;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(annotation) });
      return;
    }
    if (request.method() === 'POST') {
      const value = request.postDataJSON();
      const annotation = { id: `a${annotations.length + 1}`, elementId: value.elementId, elementName: value.elementName, text: value.text };
      annotations.push(annotation);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(annotation) });
      return;
    }
    if (request.method() === 'DELETE') {
      const id = new URL(request.url()).pathname.split('/').pop();
      deletedAnnotationId = id || '';
      annotations = annotations.filter((item) => item.id !== id);
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ annotations }) });
  });
  await internalPage.setViewportSize({ width: 640, height: 480 });
  await internalPage.goto(browser.previewUrl(), { waitUntil: 'load' });
  await internalPage.waitForFunction(() => !document.getElementById('preview')?.hasAttribute('hidden'));
  assert.match(await internalPage.locator('#agent-format').textContent() || '', /Форма 1С/);
  assert.match(await internalPage.locator('#agent-path').textContent() || '', /Nested\.xml/);
  const annotationToggle = internalPage.locator('#annotation-toggle');
  assert.equal(await annotationToggle.isVisible(), true);
  const targetBefore = await internalPage.locator('#preview [data-id="100"]').boundingBox();
  await internalPage.evaluate(() => { window.prompt = () => { throw new Error('Native prompt must not be used'); }; });
  await annotationToggle.click();
  await internalPage.locator('#preview [data-id="100"]').click();
  assert.equal(await internalPage.locator('#annotation-editor').isVisible(), true);
  assert.equal(await internalPage.locator('#annotation-target').textContent(), 'Внешние страницы');
  await internalPage.locator('#annotation-cancel').click();
  assert.equal(await internalPage.locator('#annotation-editor').isVisible(), false);
  await internalPage.locator('#preview [data-id="100"]').click();
  await internalPage.locator('#annotation-text').fill('<b>Проверить</b>');
  await internalPage.locator('#annotation-editor button[type="submit"]').click();
  await internalPage.waitForFunction(() => document.querySelectorAll('#agent-preview-pane .annotation-anchor').length === 1);
  assert.equal(annotations.length, 1, JSON.stringify(await internalPage.evaluate(() => ({
    pressed: document.getElementById('annotation-toggle')?.getAttribute('aria-pressed'),
    targetCount: document.querySelectorAll('#preview [data-id="100"]').length,
  }))));
  const annotated = internalPage.locator('#agent-preview-pane .annotation-anchor').first();
  assert.equal(await annotated.textContent(), '1');
  assert.equal(await internalPage.locator('.annotation-content span').textContent(), '<b>Проверить</b>');
  assert.equal(await annotated.getAttribute('data-element-id'), '100');
  const targetAfter = await internalPage.locator('#preview [data-id="100"]').boundingBox();
  assert.deepEqual(targetAfter, targetBefore, 'annotation must not alter form layout');
  assert.equal(await annotated.evaluate((node) => getComputedStyle(node).display), 'grid');
  assert.equal(await internalPage.locator('.annotation-content b').count(), 0, 'annotation text is not interpreted as HTML');
  const storedAnnotations = await internalPage.evaluate(async () => (await fetch('annotations')).json());
  assert.deepEqual(storedAnnotations.annotations, [{ id: 'a1', elementId: '100', elementName: 'ВнешниеСтраницы', text: '<b>Проверить</b>' }]);
  assert.ok(await internalPage.locator('#annotation-tray .ann-delete').boundingBox());
  assert.ok((await annotated.boundingBox())!.width <= 24, 'numbered marker must stay compact');
  await internalPage.locator('#annotation-tray .ann-edit').click();
  await internalPage.locator('.annotation-edit-text').fill('Ошибка');
  await internalPage.getByRole('button', { name: 'Сохранить' }).click();
  await internalPage.locator('.annotation-error').waitFor();
  assert.equal(await internalPage.locator('.annotation-edit-text').inputValue(), 'Ошибка');
  assert.equal(annotations[0].text, '<b>Проверить</b>');
  await internalPage.locator('#annotation-toggle').click();
  assert.equal(await internalPage.locator('.annotation-edit-text').inputValue(), 'Ошибка');
  await internalPage.locator('.annotation-row').locator('.annotation-content').click();
  assert.equal(await internalPage.locator('.annotation-edit-text').inputValue(), 'Ошибка');
  assert.equal(await internalPage.locator('.annotation-error').textContent(), 'Не удалось сохранить: Revision changed');
  await internalPage.locator('.annotation-edit-text').fill('Исправлено');
  await internalPage.getByRole('button', { name: 'Сохранить' }).click();
  await internalPage.waitForFunction(() => document.querySelector('.annotation-content span')?.textContent === 'Исправлено');
  assert.equal(annotations[0].id, 'a1');
  assert.equal(annotations[0].elementId, '100');
  await internalPage.locator('#annotation-tray .ann-edit').click();
  await internalPage.locator('.annotation-edit-text').fill('Не сохранять');
  await internalPage.getByRole('button', { name: 'Отмена' }).click();
  assert.equal(await internalPage.locator('.annotation-content span').textContent(), 'Исправлено');
  await internalPage.locator('#annotation-tray-toggle').click();
  assert.equal(await internalPage.locator('#annotation-list').isVisible(), false);
  await internalPage.locator('#annotation-tray-toggle').click();
  await internalPage.locator('#annotation-tray .ann-delete').click();
  await internalPage.waitForFunction(() => document.querySelectorAll('#agent-preview-pane .annotation-anchor').length === 0);
  assert.equal(deletedAnnotationId, 'a1');
  assert.equal(annotations.length, 0, JSON.stringify(await internalPage.evaluate(() => ({
    notes: document.querySelectorAll('#agent-preview-pane .annotation-anchor').length,
    buttons: document.querySelectorAll('#annotation-tray .ann-delete').length,
  }))));
  assert.equal(await internalPage.locator('#annotation-tray').isVisible(), false);
  assert.deepEqual(await internalPage.evaluate(async () => (await fetch('annotations')).json()), { annotations: [] });
  await annotationToggle.click();
  await internalPage.locator('#preview [data-id="100"]').click();
  await internalPage.locator('#annotation-text').fill('Первый');
  await internalPage.locator('#annotation-editor button[type="submit"]').click();
  await internalPage.waitForFunction(() => document.querySelectorAll('#agent-preview-pane .annotation-anchor').length === 1);
  await internalPage.locator('#preview [data-id="100"]').click();
  await internalPage.locator('#annotation-text').fill('Второй');
  await internalPage.locator('#annotation-editor button[type="submit"]').click();
  await internalPage.waitForFunction(() => document.querySelectorAll('#agent-preview-pane .annotation-anchor').length === 2);
  assert.deepEqual(await internalPage.locator('#agent-preview-pane > .annotation-anchor[data-element-id="100"]').allTextContents(), ['1', '2']);
  assert.deepEqual(await internalPage.locator('.annotation-content span').allTextContents(), ['Первый', 'Второй']);
  assert.equal(await internalPage.locator('#preview [data-id="100"]').evaluate((node) => getComputedStyle(node).display), 'flex');
  await internalPage.locator('#annotation-tray .ann-delete').first().click();
  await internalPage.waitForFunction(() => document.querySelectorAll('#agent-preview-pane .annotation-anchor').length === 1);
  assert.equal(await internalPage.locator('.annotation-content span').textContent(), 'Второй');
  const markerBeforeMove = await internalPage.locator('#agent-preview-pane .annotation-anchor').boundingBox();
  await internalPage.locator('#preview [data-id="100"]').evaluate((node) => { (node as HTMLElement).style.transform = 'translateY(20px)'; });
  await internalPage.evaluate(() => window.dispatchEvent(new Event('resize')));
  const markerAfterMove = await internalPage.locator('#agent-preview-pane .annotation-anchor').boundingBox();
  assert.ok(markerBeforeMove && markerAfterMove);
  assert.ok(Math.abs(markerAfterMove.y - markerBeforeMove.y - 20) < 2,
    'numbered marker must follow the annotated element after layout movement');
  annotations = [];
  await internalPage.reload();
  await internalPage.waitForFunction(() => !document.getElementById('preview')?.hasAttribute('hidden'));
  assert.equal(await internalPage.locator('#agent-preview-pane .annotation-anchor').count(), 0);
  const templatePath = path.join(root, 'Template.xml');
  await fs.copyFile(path.join(repositoryDir, 'testdata', 'Template.xml'), templatePath);
  await controller.open(templatePath);
  await internalPage.waitForFunction(() => document.getElementById('agent-format')?.textContent !== 'Форма 1С');
  assert.equal(await annotationToggle.isVisible(), false);
  await controller.open(formPath);
  await internalPage.waitForFunction(() => document.getElementById('agent-format')?.textContent === 'Форма 1С');
  const outlineToggle = internalPage.locator('#outline-toggle');
  const outlinePane = internalPage.locator('#outline-pane');
  assert.equal(await outlineToggle.isVisible(), true);
  assert.equal(await outlinePane.isVisible(), false);
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
  await outlineToggle.click();
  assert.equal(await outlinePane.isVisible(), true);
  const firstOutlineRow = internalPage.locator('#outline .outline-item:not([data-id=""])').first();
  const firstOutlineId = await firstOutlineRow.getAttribute('data-id');
  assert.ok(firstOutlineId);
  await firstOutlineRow.click();
  assert.equal(await internalPage.evaluate(() => window.AgentViewer.state().selectedId), firstOutlineId);
  assert.equal(await firstOutlineRow.evaluate((node) => node.classList.contains('selected')), true);
  await outlineToggle.click();
  assert.equal(await outlinePane.isVisible(), false);
  assert.equal(await outlineToggle.getAttribute('aria-expanded'), 'false');
  await outlineToggle.click();
  assert.equal(await outlinePane.isVisible(), true);
  const originalPage = (browser as unknown as { page: unknown }).page;

  const { payload: selected } = await controller.selectElement('140') as { payload: { found: boolean; state: { tabs: Array<Record<string, unknown>> } } };
  assert.equal(selected.found, true);
  assert.equal(selected.state.tabs.find((tab) => tab.pageId === '102')?.active, true);
  assert.equal(selected.state.tabs.find((tab) => tab.pageId === '115')?.active, true);

  await controller.switchTab('111', '110');
  const { payload: switched } = await controller.switchTab('112', '110');
  assert.equal(switched.tabs.find((tab) => tab.pageId === '112')?.active, true);

  const scrollablePage = switched.scrolls.find((row) => row.target === 'active-page' && Number(row.maxY) > 0);
  assert.ok(scrollablePage, `expected a vertically scrollable form page: ${JSON.stringify(switched.scrolls)}`);
  const { payload: active } = await controller.scroll({ target: 'active-page', elementId: scrollablePage.elementId, deltaY: 250 });
  assert.ok(Number((active as { after: { y: number } }).after.y) > 0);
  const { payload: table } = await controller.scroll({ target: 'table', elementId: '130', deltaX: 300, deltaY: 80 });
  assert.ok((table as { after: { x: number } }).after.x > 0);
  await controller.switchTab('115', '110');
  const { payload: spreadsheet } = await controller.scroll({ target: 'spreadsheet', elementId: '140', x: 400, y: 300 });
  assert.ok((spreadsheet as { after: { x: number; y: number } }).after.x > 0);
  assert.ok((spreadsheet as { after: { x: number; y: number } }).after.y > 0, JSON.stringify(spreadsheet));

  await fs.appendFile(formPath, '\n<!-- external reload -->\n');
  const { payload: reloaded } = await controller.reload();
  assert.equal(reloaded.state.tabs.find((tab) => tab.pageId === '115')?.active, true);
  assert.equal((browser as unknown as { page: unknown }).page, originalPage, 'browser page must be reused');
  const { image: screenshot } = await controller.capture('viewport');
  assert.deepEqual(screenshot.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.ok(screenshot.length > 10_000);
});

test('the same Edge page renders and scrolls Template.xml and MXL', async (t) => {
  const loader = await FileLoader.create([repositoryDir], maxBytes);
  const browser = new BrowserSession(options(repositoryDir));
  t.after(() => browser.close());

  const template = await browser.open(await loader.load(path.join(repositoryDir, 'testdata', 'Template.xml')));
  assert.equal(template.format, 'template');
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const templateRendering = await page.evaluate(() => {
    const host = document.getElementById('preview') as HTMLElement & { _tpModel?: { rows: Array<{ formatIndex: number }>; formats: Array<{ height?: string }> } };
    const model = host._tpModel!;
    const renderer = (window as unknown as { TemplatePreview: {
      render(model: unknown, node: HTMLElement, options: object): void;
      highlight(node: HTMLElement, id: string): HTMLElement | null;
    } }).TemplatePreview;
    const autoModel = JSON.parse(JSON.stringify(model));
    autoModel.formats.push({ height: '-45', textPlacement: 'Wrap' });
    const rowIndex = autoModel.rows.findIndex((row: { cells: unknown[] }) => row.cells.length > 0);
    autoModel.rows[rowIndex].formatIndex = autoModel.formats.length;
    autoModel.rows[rowIndex].cells[0].text = 'first line\nsecond line\nthird line';
    const probe = document.createElement('div');
    document.body.appendChild(probe);
    renderer.render(autoModel, probe, {});
    const cells = Array.from(probe.querySelectorAll<HTMLElement>(`tr[data-row="${rowIndex}"] .tp-cell`));
    const selected = renderer.highlight(host, 'r0c0');
    probe.remove();
    return {
      autoCells: cells.length,
      fixedAutoCells: cells.filter((cell) => !!cell.style.height || getComputedStyle(cell.parentElement!).overflow === 'hidden').length,
      selectedId: selected?.getAttribute('data-id') || '',
    };
  });
  assert.ok(templateRendering.autoCells > 0);
  assert.equal(templateRendering.fixedAutoCells, 0);
  assert.equal(templateRendering.selectedId, 'r0c0');
  const templateScroll = await browser.scroll({ target: 'document', deltaX: 500, deltaY: 400 }) as { after: { x: number; y: number } };
  assert.ok(templateScroll.after.x > 0);
  assert.ok(templateScroll.after.y > 0);

  const mxl = await browser.open(await loader.load(path.join(repositoryDir, 'testdata', 'upd.mxl')));
  assert.equal(mxl.format, 'mxl');
  assert.equal((browser as unknown as { page: unknown }).page, page);
  const mxlScroll = await browser.scroll({ target: 'document', deltaX: 500, deltaY: 400 }) as { after: { x: number; y: number } };
  assert.ok(mxlScroll.after.x > 0);
  assert.ok(mxlScroll.after.y > 0);

  await browser.open(await loader.load(path.join(repositoryDir, 'testdata', 'mxl-capabilities.mxl')));
  assert.equal((await page.locator('td[data-row="30"][data-col="3"] .tp-cell').textContent())?.trim(), 'Двойная');
  assert.equal((await page.locator('td[data-row="30"][data-col="5"] .tp-cell').textContent())?.trim(), 'Точечная');
});


test('a different document does not inherit the previous one’s selected tab', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-tabstate-'));
  const first = path.join(root, 'First.xml');
  const second = path.join(root, 'Second.xml');
  await fs.writeFile(first, twinPagesForm('А'));
  await fs.writeFile(second, twinPagesForm('Б'));
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  const controller = new ViewerController(loader, browser);
  t.after(async () => {
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await controller.open(first);
  const { payload: onSecondTab } = await controller.switchTab('102', '100');
  assert.equal(onSecondTab.tabs.find((tab) => tab.pageId === '102')?.active, true);

  const { payload: other } = await controller.open(second);
  assert.equal(other.state.tabs.find((tab) => tab.pageId === '101')?.active, true);
  assert.equal(other.state.tabs.find((tab) => tab.pageId === '102')?.active, false);

  /* Re-opening the file the agent was already on is a reload, and a reload
   * keeps the view where it was. */
  await controller.open(first);
  const { payload: reopened } = await controller.switchTab('102', '100');
  assert.equal(reopened.tabs.find((tab) => tab.pageId === '102')?.active, true);
  const { payload: reloaded } = await controller.reload();
  assert.equal(reloaded.state.tabs.find((tab) => tab.pageId === '102')?.active, true);
});

test('capture restores the session viewport and reports the frame it returned', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-capture-state-'));
  const formPath = path.join(root, 'Nested.xml');
  await fs.writeFile(formPath, nestedForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  const controller = new ViewerController(loader, browser);
  t.after(async () => {
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await controller.open(formPath);
  await controller.switchTab('112', '110');

  /* A size asked for one picture frames that picture — the state shipped with
   * it describes that framing — and the session goes back to its own size. */
  const { payload: resized } = await controller.capture('viewport', undefined, { width: 900, height: 700 });
  assert.equal(resized.state.summary.viewportWidth, 900);
  assert.equal(resized.state.summary.viewportHeight, 700);
  const { payload: afterResize } = await controller.capture('viewport');
  assert.equal(afterResize.state.summary.viewportWidth, 640);
  assert.equal(afterResize.state.summary.viewportHeight, 480);

  /* Capturing an element scrolls it into view, so the state that ships with
   * the PNG has to be read after the capture, not before it. The form nests
   * two Pages, so pick the panel that actually scrolls. */
  const scrollable = (area: { target: string; maxY: number }) => area.target === 'active-page' && area.maxY > 0;
  const before = (await controller.capture('viewport')).payload.state.scrolls.find(scrollable);
  assert.ok(before, 'the long page must be a scrollable area');
  assert.equal(before.y, 0);
  const { payload: element, image } = await controller.capture('element', '234');
  assert.deepEqual(image.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const scrolled = element.state.scrolls.find((area) => area.elementId === before.elementId);
  assert.ok(scrolled && scrolled.y > 0, `state must describe the captured frame: ${JSON.stringify(element.state.scrolls)}`);
});

test('reload puts every scrolled area back where it was', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '1c-form-reload-scroll-'));
  const formPath = path.join(root, 'Nested.xml');
  await fs.writeFile(formPath, nestedForm());
  const loader = await FileLoader.create([root], maxBytes);
  const browser = new BrowserSession(options(root));
  const controller = new ViewerController(loader, browser);
  t.after(async () => {
    await controller.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  await controller.open(formPath);
  await controller.switchTab('112', '110');
  const { payload: table } = await controller.scroll({ target: 'table', elementId: '130', x: 240, y: 0 });
  const scrolledX = Number((table as { after: { x: number } }).after.x);
  assert.ok(scrolledX > 0);

  await fs.appendFile(formPath, '\n<!-- external reload -->\n');
  const { payload: reloaded } = await controller.reload();
  assert.equal(reloaded.state.tabs.find((tab) => tab.pageId === '112')?.active, true);
  const restored = reloaded.state.scrolls.find((area) => area.target === 'table' && area.elementId === '130');
  assert.ok(restored, `the reloaded document must still offer the table: ${JSON.stringify(reloaded.state.scrolls)}`);
  assert.equal(restored.x, scrolledX);
});

test('an auto caption promoted by a narrow window returns to the left when it widens', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-auto-title-revert-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Header" id="1"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
    <UsualGroup name="Left" id="2"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
      <InputField name="Reason" id="3"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Основание увольнения</v8:content></v8:item></Title></InputField>
      <InputField name="Article" id="4"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Статья трудового кодекса</v8:content></v8:item></Title></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="Right" id="5"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
      <InputField name="Order" id="6"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Номер приказа</v8:content></v8:item></Title></InputField>
      <InputField name="Signer" id="7"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Подписант документа</v8:content></v8:item></Title></InputField>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1600, height: 480 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const state = () => page.evaluate(() => {
    const rows = ['3', '4', '6', '7'].map((id) => {
      const row = document.querySelector(`[data-id="${id}"] .fp-field-row`) as HTMLElement;
      const label = row.querySelector('.fp-field-label') as HTMLElement;
      return {
        id,
        top: row.classList.contains('fp-title-top'),
        left: row.classList.contains('fp-title-left'),
        promoted: row.dataset.fpPromoted === '1',
        labelMinWidth: label ? label.style.minWidth : '',
      };
    });
    const owner = document.querySelector('[data-id="2"]') as HTMLElement;
    return {
      rows,
      ownerMinWidth: owner.style.minWidth,
      ownerOverflow: owner.classList.contains('fp-auto-title-overflow'),
    };
  });

  const wide = await state();
  assert.ok(wide.rows.every((row) => row.left && !row.top && !row.promoted), JSON.stringify(wide));
  const authoredLabelWidths = wide.rows.map((row) => row.labelMinWidth);

  await page.setViewportSize({ width: 520, height: 480 });
  await page.waitForFunction(() =>
    document.querySelectorAll('.fp-field-row[data-fp-promoted]').length > 0, null, { timeout: 5000 });
  const narrow = await state();
  assert.ok(narrow.rows.some((row) => row.top && row.promoted), JSON.stringify(narrow));

  await page.setViewportSize({ width: 1600, height: 480 });
  await page.waitForFunction(() =>
    document.querySelectorAll('.fp-field-row[data-fp-promoted]').length === 0, null, { timeout: 5000 });
  const restored = await state();
  assert.ok(restored.rows.every((row) => row.left && !row.top && !row.promoted), JSON.stringify(restored));
  assert.equal(restored.ownerOverflow, false, JSON.stringify(restored));
  assert.equal(restored.ownerMinWidth, wide.ownerMinWidth, JSON.stringify({ wide, restored }));
  assert.deepEqual(restored.rows.map((row) => row.labelMinWidth), authoredLabelWidths,
    JSON.stringify({ wide, restored }));
});

test('Taxi spacing applies None, Half, OneAndHalf and Double gaps in the browser', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-taxi-spacing-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform"><Group>Vertical</Group><HorizontalSpacing>OneAndHalf</HorizontalSpacing><VerticalSpacing>Double</VerticalSpacing><ChildItems>
  <UsualGroup name="NoGap" id="1"><Group>AlwaysHorizontal</Group><Representation>None</Representation><HorizontalSpacing>None</HorizontalSpacing><ChildItems>
    <Button name="A" id="2"/><Button name="B" id="3"/>
  </ChildItems></UsualGroup>
  <UsualGroup name="HalfGap" id="4"><Group>Vertical</Group><Representation>None</Representation><VerticalSpacing>Half</VerticalSpacing><ChildItems>
    <Button name="C" id="5"/><Button name="D" id="6"/>
  </ChildItems></UsualGroup>
  <UsualGroup name="PopupDefault" id="7"><Group>Vertical</Group><Behavior>PopUp</Behavior><Representation>None</Representation><ChildItems>
    <LabelDecoration name="P1" id="8"><Title>P1</Title></LabelDecoration><LabelDecoration name="P2" id="9"><Title>P2</Title></LabelDecoration><LabelDecoration name="P3" id="10"><Title>P3</Title></LabelDecoration>
  </ChildItems></UsualGroup>
  <UsualGroup name="PopupAuto" id="11"><Group>Vertical</Group><Behavior>PopUp</Behavior><Representation>None</Representation><VerticalSpacing>Auto</VerticalSpacing><ChildItems>
    <LabelDecoration name="A1" id="12"><Title>A1</Title></LabelDecoration><LabelDecoration name="A2" id="13"><Title>A2</Title></LabelDecoration><LabelDecoration name="A3" id="14"><Title>A3</Title></LabelDecoration>
  </ChildItems></UsualGroup>
  <UsualGroup name="PopupNone" id="15"><Group>Vertical</Group><Behavior>PopUp</Behavior><Representation>None</Representation><VerticalSpacing>None</VerticalSpacing><ChildItems>
    <LabelDecoration name="N1" id="16"><Title>N1</Title></LabelDecoration><LabelDecoration name="N2" id="17"><Title>N2</Title></LabelDecoration><LabelDecoration name="N3" id="18"><Title>N3</Title></LabelDecoration>
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 420 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const gaps = await page.evaluate(() => {
    const body = document.querySelector('.fp-body') as HTMLElement;
    const noGap = document.querySelector('[data-id="1"] .fp-children') as HTMLElement;
    const halfGap = document.querySelector('[data-id="4"] .fp-children') as HTMLElement;
    const popupDefault = document.querySelector('[data-id="7"] .fp-children') as HTMLElement;
    const popupAuto = document.querySelector('[data-id="11"] .fp-children') as HTMLElement;
    const popupNone = document.querySelector('[data-id="15"] .fp-children') as HTMLElement;
    const p8 = (document.querySelector('.fp-body .fp-item[data-id="8"]') as HTMLElement).getBoundingClientRect();
    const p9 = (document.querySelector('.fp-body .fp-item[data-id="9"]') as HTMLElement).getBoundingClientRect();
    const p10 = (document.querySelector('.fp-body .fp-item[data-id="10"]') as HTMLElement).getBoundingClientRect();
    const p12 = (document.querySelector('.fp-body .fp-item[data-id="12"]') as HTMLElement).getBoundingClientRect();
    const p13 = (document.querySelector('.fp-body .fp-item[data-id="13"]') as HTMLElement).getBoundingClientRect();
    const p14 = (document.querySelector('.fp-body .fp-item[data-id="14"]') as HTMLElement).getBoundingClientRect();
    const p16 = (document.querySelector('.fp-body .fp-item[data-id="16"]') as HTMLElement).getBoundingClientRect();
    const p17 = (document.querySelector('.fp-body .fp-item[data-id="17"]') as HTMLElement).getBoundingClientRect();
    const p18 = (document.querySelector('.fp-body .fp-item[data-id="18"]') as HTMLElement).getBoundingClientRect();
    return {
      bodyRow: getComputedStyle(body).rowGap,
      bodyColumn: getComputedStyle(body).columnGap,
      noneColumn: getComputedStyle(noGap).columnGap,
      halfRow: getComputedStyle(halfGap).rowGap,
      popupDefaultRow: getComputedStyle(popupDefault).rowGap,
      popupAutoRow: getComputedStyle(popupAuto).rowGap,
      popupNoneRow: getComputedStyle(popupNone).rowGap,
      popupDefaultDisplay: getComputedStyle(popupDefault).display,
      popupDefaultDirection: getComputedStyle(popupDefault).flexDirection,
      popupDefaultGaps: [Math.round(p9.top - p8.bottom), Math.round(p10.top - p9.bottom)],
      popupAutoGaps: [Math.round(p13.top - p12.bottom), Math.round(p14.top - p13.bottom)],
      popupNoneGaps: [Math.round(p17.top - p16.bottom), Math.round(p18.top - p17.bottom)],
    };
  });
  assert.deepEqual(gaps, {
    // Vertical Half is 5px: the layout contract's large-font 4.5 is rounded up
    // per gap rather than accumulated, so the platform paints every Half as a full band.
    bodyRow: '18px', bodyColumn: '12px', noneColumn: '0px', halfRow: '5px',
    popupDefaultRow: '9px', popupAutoRow: '3px', popupNoneRow: '0px',
    popupDefaultDisplay: 'flex', popupDefaultDirection: 'column',
    popupDefaultGaps: [9, 9], popupAutoGaps: [3, 3], popupNoneGaps: [0, 0],
  });
});

test('ThroughAlign keeps caption widths local to each generated vertical column', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-through-align-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  const column = (id: number, prefix: string, long: boolean) => `
    <UsualGroup name="${prefix}" id="${id}"><Group>Vertical</Group><Representation>None</Representation><ChildItems>
      <InputField name="${prefix}A" id="${id + 1}"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>${long ? 'Очень длинный заголовок' : 'Код'}</v8:content></v8:item></Title></InputField>
      <InputField name="${prefix}B" id="${id + 2}"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>${long ? 'Наименование' : 'Дата'}</v8:content></v8:item></Title></InputField>
    </ChildItems></UsualGroup>`;
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Auto" id="1"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ChildItems>
    ${column(10, 'AutoShort', false)}${column(20, 'AutoLong', true)}
  </ChildItems></UsualGroup>
  <UsualGroup name="Use" id="2"><Group>AlwaysHorizontal</Group><Representation>None</Representation><ThroughAlign>Use</ThroughAlign><ChildItems>
    ${column(30, 'UseShort', false)}${column(40, 'UseLong', true)}
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1400, height: 560 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const widths = await page.evaluate(() => {
    const autoShortNodes = document.querySelectorAll('[data-id="10"] .fp-field-label');
    const autoLongNodes = document.querySelectorAll('[data-id="20"] .fp-field-label');
    const useShortNodes = document.querySelectorAll('[data-id="30"] .fp-field-label');
    const useLongNodes = document.querySelectorAll('[data-id="40"] .fp-field-label');
    const autoOwner = document.querySelector('[data-id="1"] .fp-children') as HTMLElement;
    const useOwner = document.querySelector('[data-id="2"] .fp-children') as HTMLElement;
    const firstFieldRow = document.querySelector('[data-id="11"] .fp-field-row') as HTMLElement;
    return {
      autoShort: Array.from(autoShortNodes).map((node) => parseFloat((node as HTMLElement).style.minWidth || '0')),
      autoLong: Array.from(autoLongNodes).map((node) => parseFloat((node as HTMLElement).style.minWidth || '0')),
      useShort: Array.from(useShortNodes).map((node) => parseFloat((node as HTMLElement).style.minWidth || '0')),
      useLong: Array.from(useLongNodes).map((node) => parseFloat((node as HTMLElement).style.minWidth || '0')),
      autoScope: autoOwner?.dataset.fpThroughAlignScope,
      useScope: useOwner?.dataset.fpThroughAlignScope,
      fieldGap: getComputedStyle(firstFieldRow).columnGap,
    };
  });
  assert.ok(widths.autoShort.length === 2 && widths.autoLong.length === 2, JSON.stringify(widths));
  assert.equal(widths.autoShort[0], widths.autoShort[1], JSON.stringify(widths));
  assert.equal(widths.autoLong[0], widths.autoLong[1], JSON.stringify(widths));
  assert.notEqual(widths.autoShort[0], widths.autoLong[0], JSON.stringify(widths));
  assert.equal(widths.useShort[0], widths.useShort[1], JSON.stringify(widths));
  assert.equal(widths.useLong[0], widths.useLong[1], JSON.stringify(widths));
  assert.notEqual(widths.useShort[0], widths.useLong[0], JSON.stringify(widths));
  assert.equal(widths.autoScope, 'linked-local');
  assert.equal(widths.useScope, 'across-columns');
  assert.equal(widths.fieldGap, '5px');
});

test('HorizontalIfPossible regroups on a narrow viewport and restores on widening', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-responsive-group-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Responsive" id="1"><Group>HorizontalIfPossible</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
    <InputField name="First" id="2"><Width>26</Width><HorizontalStretch>false</HorizontalStretch><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Первое длинное поле</v8:content></v8:item></Title></InputField>
    <InputField name="Second" id="3"><Width>26</Width><HorizontalStretch>false</HorizontalStretch><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Второе длинное поле</v8:content></v8:item></Title></InputField>
  </ChildItems></UsualGroup>
  <UsualGroup name="Fixed" id="4"><Group>AlwaysHorizontal</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
    <InputField name="FixedFirst" id="5"><Width>26</Width><HorizontalStretch>false</HorizontalStretch></InputField>
    <InputField name="FixedSecond" id="6"><Width>26</Width><HorizontalStretch>false</HorizontalStretch></InputField>
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 1100, height: 480 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const state = () => page.evaluate(() => {
    const responsive = document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]') as HTMLElement;
    const formBody = responsive?.closest('.fp-body') as HTMLElement;
    const fixed = document.querySelector('[data-id="4"] .fp-children') as HTMLElement;
    const first = document.querySelector('[data-id="2"]') as HTMLElement;
    const second = document.querySelector('[data-id="3"]') as HTMLElement;
    return {
      responsiveOrientation: responsive?.dataset.fpSelectedOrientation,
      responsiveVertical: responsive?.classList.contains('fp-children-vertical'),
      horizontalStrategy: formBody?.dataset.fpHorizontalStrategy,
      verticalGroupingCount: Number(formBody?.dataset.fpVerticalGroupingCount || 0),
      fixedHorizontal: fixed?.classList.contains('fp-children-horizontal'),
      firstTop: Math.round(first.getBoundingClientRect().top),
      secondTop: Math.round(second.getBoundingClientRect().top),
    };
  });

  const wide = await state();
  assert.equal(wide.responsiveOrientation, 'horizontal', JSON.stringify(wide));
  assert.equal(wide.horizontalStrategy, 'auto', JSON.stringify(wide));
  assert.equal(wide.firstTop, wide.secondTop, JSON.stringify(wide));

  await page.setViewportSize({ width: 430, height: 480 });
  await page.waitForFunction(() =>
    document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]')
      ?.getAttribute('data-fp-selected-orientation') === 'vertical', null, { timeout: 5000 });
  const narrow = await state();
  assert.equal(narrow.responsiveVertical, true, JSON.stringify(narrow));
  assert.equal(narrow.horizontalStrategy, 'compress-width', JSON.stringify(narrow));
  assert.equal(narrow.verticalGroupingCount, 1, JSON.stringify(narrow));
  assert.ok(narrow.secondTop > narrow.firstTop, JSON.stringify(narrow));
  assert.equal(narrow.fixedHorizontal, true, JSON.stringify(narrow));

  await page.setViewportSize({ width: 1100, height: 480 });
  await page.waitForFunction(() =>
    document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]')
      ?.getAttribute('data-fp-selected-orientation') === 'horizontal', null, { timeout: 5000 });
  const restored = await state();
  assert.equal(restored.firstTop, restored.secondTop, JSON.stringify(restored));
  assert.equal(restored.horizontalStrategy, 'auto', JSON.stringify(restored));
});

test('HorizontalIfPossible projected logical children use the finite parent track', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-responsive-projected-track-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Responsive" id="1"><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
    <UsualGroup name="WideLogical" id="2"><Group>AlwaysHorizontal</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><United>false</United><ChildItems>
      <InputField name="Wide" id="3"><Width>30</Width><HorizontalStretch>false</HorizontalStretch><TitleLocation>None</TitleLocation></InputField>
    </ChildItems></UsualGroup>
    <UsualGroup name="TrailingLogical" id="4"><Group>AlwaysHorizontal</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><United>false</United><ChildItems>
      <InputField name="Trailing" id="5"><Width>12</Width><HorizontalStretch>false</HorizontalStretch><TitleLocation>None</TitleLocation></InputField>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup>
  <UsualGroup name="RootBand" id="10"><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><Group>Vertical</Group><ChildItems>
    <UsualGroup name="LocalWideRow" id="11"><Group>AlwaysHorizontal</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
      <InputField name="LocalWide" id="12"><Width>26</Width><HorizontalStretch>false</HorizontalStretch><TitleLocation>None</TitleLocation></InputField>
      <InputField name="LocalTail" id="13"><Width>12</Width><HorizontalStretch>false</HorizontalStretch><TitleLocation>None</TitleLocation></InputField>
    </ChildItems></UsualGroup>
  </ChildItems></UsualGroup>
  <LabelDecoration name="FiniteSibling" id="14"><HorizontalStretch>true</HorizontalStretch><Title>Finite sibling</Title></LabelDecoration>
  <Pages name="Alternatives" id="20"><Width>27</Width><HorizontalStretch>false</HorizontalStretch><VerticalStretch>false</VerticalStretch><PagesRepresentation>None</PagesRepresentation><ChildItems>
    <Page name="Short" id="21"><VerticalStretch>false</VerticalStretch><Group>AlwaysHorizontal</Group><ChildItems>
      <PictureDecoration name="ShortPaint" id="22"><Title>Short</Title></PictureDecoration>
    </ChildItems></Page>
    <Page name="Tall" id="23"><VerticalStretch>false</VerticalStretch><Group>AlwaysHorizontal</Group><ChildItems>
      <UsualGroup name="TallContent" id="24"><Width>27</Width><Group>Vertical</Group><Behavior>PopUp</Behavior><Representation>None</Representation><ChildItems>
        <LabelDecoration name="LongInactiveText" id="25"><AutoMaxWidth>false</AutoMaxWidth><MaxWidth>27</MaxWidth><HorizontalStretch>true</HorizontalStretch><Title formatted="false"><v8:item><v8:lang>ru</v8:lang><v8:content>Первая длинная строка неактивной страницы для проверки высоты.
Вторая длинная строка неактивной страницы для проверки высоты.
Третья длинная строка неактивной страницы для проверки высоты.

Четвертая длинная строка неактивной страницы для проверки высоты.</v8:content></v8:item></Title></LabelDecoration>
      </ChildItems></UsualGroup>
    </ChildItems></Page>
  </ChildItems></Pages>
  <LabelDecoration name="AfterAlternatives" id="26"><Title>After alternatives</Title></LabelDecoration>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 620, height: 360 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const state = () => page.evaluate(() => {
    const responsive = document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]') as HTMLElement;
    const first = document.querySelector('[data-id="2"]') as HTMLElement;
    const second = document.querySelector('[data-id="4"]') as HTMLElement;
    const parent = responsive?.closest('[data-id="1"]') as HTMLElement;
    const body = document.querySelector('.fp-body') as HTMLElement;
    const rootBand = document.querySelector('[data-id="10"]') as HTMLElement;
    const sibling = document.querySelector('[data-id="14"]') as HTMLElement;
    const alternatives = document.querySelector('[data-id="20"]') as HTMLElement;
    const afterAlternatives = document.querySelector('[data-id="26"]') as HTMLElement;
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return {
      orientation: responsive?.dataset.fpSelectedOrientation,
      first: { x: Math.round(a.x), y: Math.round(a.y), right: Math.round(a.right), bottom: Math.round(a.bottom) },
      second: { x: Math.round(b.x), y: Math.round(b.y), right: Math.round(b.right), bottom: Math.round(b.bottom) },
      parent: { x: Math.round(p.x), right: Math.round(p.right) },
      body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth,
        right: Math.round(body.getBoundingClientRect().right), top: Math.round(body.getBoundingClientRect().top),
        className: body.className },
      rootBandOverflowX: getComputedStyle(rootBand).overflowX,
      rootBandOwned: rootBand.classList.contains('fp-root-band-overflow'),
      siblingRight: Math.round(sibling.getBoundingClientRect().right),
      alternativesHeight: Math.round(alternatives.getBoundingClientRect().height),
      alternativesBottom: Math.round(alternatives.getBoundingClientRect().bottom),
      alternativesEnvelope: Number(alternatives.dataset.fpFlattenedPagesEnvelope || 0),
      inactivePaintCount: alternatives.querySelectorAll('[data-id="25"]').length,
      afterAlternativesY: Math.round(afterAlternatives.getBoundingClientRect().y),
      rootBands: Array.from(body.children).map((node) => {
        const el = node as HTMLElement; const r = el.getBoundingClientRect();
        return { id: el.dataset.id, y: Math.round(r.y), h: Math.round(r.height) };
      }),
    };
  });

  const wide = await state();
  assert.equal(wide.orientation, 'horizontal', JSON.stringify(wide));

  await page.setViewportSize({ width: 340, height: 360 });
  await page.waitForFunction(() =>
    document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]')
      ?.getAttribute('data-fp-selected-orientation') === 'vertical', null, { timeout: 5000 });
  const narrow = await state();
  assert.equal(narrow.orientation, 'vertical', JSON.stringify(narrow));
  assert.equal(narrow.second.x, narrow.first.x, JSON.stringify(narrow));
  assert.ok(narrow.second.y >= narrow.first.bottom, JSON.stringify(narrow));
  assert.ok(narrow.first.right <= narrow.parent.right + 1, JSON.stringify(narrow));
  assert.ok(narrow.second.right <= narrow.parent.right + 1, JSON.stringify(narrow));
  assert.ok(narrow.body.scrollWidth > narrow.body.clientWidth, JSON.stringify(narrow));
  assert.equal(narrow.rootBandOverflowX, 'visible', JSON.stringify(narrow));
  assert.equal(narrow.rootBandOwned, true, JSON.stringify(narrow));
  assert.ok(narrow.siblingRight <= narrow.body.right + 1, JSON.stringify(narrow));
  assert.ok(narrow.alternativesEnvelope > 100, JSON.stringify(narrow));
  assert.ok(narrow.alternativesHeight >= narrow.alternativesEnvelope, JSON.stringify(narrow));
  assert.equal(narrow.inactivePaintCount, 0, JSON.stringify(narrow));
  const compactFollowingGap = narrow.afterAlternativesY - narrow.alternativesBottom;
  await page.evaluate(() => {
    const root = document.querySelector('.fp-root') as HTMLElement;
    (window as any).FormPreview.highlight(root, '25');
  });
  await page.waitForFunction(() => document.querySelector('[data-id="20"] [data-id="25"]'));
  const tallActive = await state();
  assert.equal(tallActive.alternativesHeight, narrow.alternativesHeight, JSON.stringify(tallActive));
  assert.ok(Math.abs(tallActive.afterAlternativesY - narrow.afterAlternativesY) <= 1,
    JSON.stringify({ narrow, tallActive, compactFollowingGap,
      tallFollowingGap: tallActive.afterAlternativesY - tallActive.alternativesBottom }));

  await page.setViewportSize({ width: 620, height: 360 });
  await page.waitForFunction(() =>
    document.querySelector('[data-id="1"] [data-fp-responsive-group="1"]')
      ?.getAttribute('data-fp-selected-orientation') === 'horizontal', null, { timeout: 5000 });
  const restored = await state();
  assert.equal(restored.orientation, 'horizontal', JSON.stringify(restored));
  assert.equal(restored.first.y, restored.second.y, JSON.stringify(restored));
  assert.ok(restored.second.right <= restored.parent.right + 1, JSON.stringify(restored));
});

test('GroupHorizontalAlign centres an item in a row and in a column', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-group-align-centre-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core"><Group>Vertical</Group><ChildItems>
  <UsualGroup name="Row" id="1"><Group>AlwaysHorizontal</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
    <Button name="Centred" id="2"><GroupHorizontalAlign>Center</GroupHorizontalAlign><Title><v8:item><v8:lang>ru</v8:lang><v8:content>По центру</v8:content></v8:item></Title></Button>
  </ChildItems></UsualGroup>
  <UsualGroup name="Column" id="3"><Group>Vertical</Group><HorizontalStretch>true</HorizontalStretch><Representation>None</Representation><ChildItems>
    <Button name="CentredInColumn" id="4"><GroupHorizontalAlign>Center</GroupHorizontalAlign><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Тоже по центру</v8:content></v8:item></Title></Button>
  </ChildItems></UsualGroup>
</ChildItems></Form>`);
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 400 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  const measured = await page.evaluate(() => [['1', '2'], ['3', '4']].map((pair) => {
    const owner = (document.querySelector(`[data-id="${pair[0]}"] .fp-children`) as HTMLElement)
      .getBoundingClientRect();
    const item = document.querySelector(`[data-id="${pair[1]}"]`) as HTMLElement;
    const box = item.getBoundingClientRect();
    return {
      offset: (box.left + box.right) / 2 - (owner.left + owner.right) / 2,
      ownerWidth: owner.width,
      itemWidth: box.width,
      marked: item.classList.contains('fp-align-center'),
    };
  }));
  const centring = { row: measured[0], column: measured[1] };
  assert.equal(centring.row.marked, true, JSON.stringify(centring));
  assert.equal(centring.column.marked, true, JSON.stringify(centring));
  assert.ok(centring.row.ownerWidth - centring.row.itemWidth > 100, JSON.stringify(centring));
  assert.ok(centring.column.ownerWidth - centring.column.itemWidth > 100, JSON.stringify(centring));
  assert.ok(Math.abs(centring.row.offset) < 2, JSON.stringify(centring));
  assert.ok(Math.abs(centring.column.offset) < 2, JSON.stringify(centring));
});

function dataProcessorCommandBarForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
    <Button name="КнопкаОбменяться" id="1"><Type>CommandBarButton</Type><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Обменяться</v8:content></v8:item></Title></Button>
  </ChildItems></AutoCommandBar>
  <ChildItems>
    <CommandBar name="ГруппаКнопок" id="10"><ChildItems>
      <Button name="Отобрать" id="11"><Type>CommandBarButton</Type><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Отобрать</v8:content></v8:item></Title></Button>
    </ChildItems></CommandBar>
  </ChildItems>
  <Attributes><Attribute name="ОтборУчетнаяЗапись" id="100"><Type><v8:Type>xs:string</v8:Type></Type></Attribute></Attributes>
</Form>`;
}

function bareRootFieldForm(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Form xmlns="http://v8.1c.ru/8.3/xcf/logform" xmlns:v8="http://v8.1c.ru/8.1/data/core">
  <AutoCommandBar name="ФормаКоманднаяПанель" id="-1"><ChildItems>
    <Button name="КнопкаОбменяться" id="1"><Type>CommandBarButton</Type><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Обменяться</v8:content></v8:item></Title></Button>
  </ChildItems></AutoCommandBar>
  <ChildItems>
    <InputField name="ПолеОтбор" id="10"><Title><v8:item><v8:lang>ru</v8:lang><v8:content>Отбор</v8:content></v8:item></Title></InputField>
  </ChildItems>
  <Attributes><Attribute name="Отбор" id="100"><Type><v8:Type>xs:string</v8:Type></Type></Attribute></Attributes>
</Form>`;
}

/* The platform spends 10px from the painted command bar bottom to the first painted
 * editor top. A bare control in the root ChildItems used to spend 14 by
 * double-counting its item chrome over the full row gap. */
test('a bare root field opens on the platform’s 10px gap below the form command bar', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-bare-root-field-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, bareRootFieldForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 400 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  // No named closures here: tsx keepNames would inject an undefined __name helper.
  const gap = await page.evaluate(() => {
    const bar = document.querySelector('.fp-body > .fp-item[data-tag="AutoCommandBar"] .fp-commandbar') as HTMLElement;
    const editor = document.querySelector('.fp-body > .fp-item[data-tag="InputField"] .fp-input-wrap') as HTMLElement;
    return Math.round(editor.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
  });
  assert.equal(gap, 10, `bar bottom to editor top was ${gap}px, the platform spends 10`);
});

/* The platform draws «Еще» on the form's own AutoCommandBar whatever the
 * form's object kind, so a DataProcessor form keeps it. An authored CommandBar
 * group is not a form bar and has no platform «Еще», so it must not gain one. */
test('a DataProcessor form bar keeps «Еще» while an authored CommandBar group does not', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), '1c-dataprocessor-more-'));
  const formPath = path.join(tempRoot, 'Form.xml');
  await fs.writeFile(formPath, dataProcessorCommandBarForm());
  const loader = await FileLoader.create([tempRoot], maxBytes);
  const browser = new BrowserSession({ ...options(tempRoot), viewport: { width: 900, height: 400 } });
  t.after(async () => {
    await browser.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  await browser.open(await loader.load(formPath));
  const page = (browser as unknown as { page: import('playwright-core').Page }).page;
  // No named closures here: tsx keepNames would inject an undefined __name helper.
  const found = await page.evaluate(() => {
    const formBar = document.querySelectorAll('.fp-body > .fp-item[data-tag="AutoCommandBar"] > .fp-control-wrap > .fp-commandbar .fp-more-item .fp-button');
    const group = document.querySelectorAll('.fp-item[data-tag="CommandBar"] .fp-commandbar .fp-more-item .fp-button');
    return {
      formBar: Array.from(formBar).map((btn) => btn.textContent?.trim() || ''),
      group: Array.from(group).map((btn) => btn.textContent?.trim() || ''),
    };
  });
  assert.deepEqual(found.formBar, ['Еще ▾'], JSON.stringify(found));
  assert.deepEqual(found.group, [], JSON.stringify(found));
});
