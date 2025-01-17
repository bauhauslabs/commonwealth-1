/* eslint-disable max-len */
import m from 'mithril';
import 'pages/landing/input_token_option.scss';

const ADD_TOKEN_LINK = 'https://hicommonwealth.typeform.com/to/cRP27Rp5';

interface IAttrs {
  iconImg: string;
  text: string;
  route: string;
}

interface IState {
  index: number;
  liSelected: any;
}
const InputTokenOptionComponent: m.Component<IAttrs, IState> = {
  view: (vnode) => {
    const { iconImg } = vnode.attrs;

    let tokenImage;
    if (!iconImg || !iconImg.length || iconImg.slice(0, 4) === 'ipfs') {
      tokenImage = m('.TokenIcon', [
        m('.token-icon.no-image', {
          style: 'width: 1.5rem; height: 1.5rem; margin-right: 1rem;',
          onclick,
        }, [
          m('span', {
            style: 'font-size: 1.25rem'
          }, vnode.attrs.text.slice(0, 1)),
        ]),
      ]);
    } else {
      tokenImage = m('img', {
        class: 'mr-4 h-6 w-6',
        src: iconImg,
        alt: '',
      });
    }

    return m(
      'li',
      { class: '' },
      m(
        'button',
        {
          type: 'button',
          onclick: (e) => {
            if (vnode.attrs.route === 'placeholder') {
              e.preventDefault();
              window.location.href = ADD_TOKEN_LINK;
            } else {
              e.preventDefault();
              localStorage['home-scrollY'] = window.scrollY;
              m.route.set(`/${vnode.attrs.route}`);
            }
          },
          class:
            vnode.attrs.route === 'placeholder'
              ? 'p-3 InputAddToken mb-5'
              : 'p-3 rounded hover:bg-gray-100 flex flex-grow items-center flex-row text-left leading-none w-full justify-between focus:outline-none',
        },
        m(
          'span',
          {
            class:
              vnode.attrs.route === 'placeholder'
                ? 'flex flex-row InputAddTokenText'
                : 'flex flex-row font-bold',
          },
          [tokenImage, m('span', { class: 'mt-1' }, vnode.attrs.text)]
        )
      )
    );
  },
};

export default InputTokenOptionComponent;
