import m from 'mithril';

interface IState {
  chains: {
    img: string;
    id: string;
    placeholder?: boolean;
    chainInfo: string;
    name: string;
  }[];
  oncreateSlider: Function;
}

const TokensChainsComponent: m.Component<IState, IState> = {
  oninit: (vnode) => {
    vnode.state.oncreateSlider = vnode.attrs.oncreateSlider;
  },
  oncreate: (vnode) => {
    vnode.state.oncreateSlider();
  },
  view: (vnode) => {
    return m(
      'section',
      {
        class:
          'bg-geometric-pattern bg-cover bg-full pt-20 pb-40 md:pb-48 mb-48 relative',
      },
      [
        m('div', { class: 'container mx-auto' }, [
          m(
            'h2',
            {
              class: 'text-3xl text-left font-extrabold mb-5 md:text-center',
            },
            ' Every Token. Every Chain. '
          ),
          m(
            'p',
            {
              class:
                'text-left max-w-screen-md mx-auto text-2xl md:text-center',
            },
            ' With Commonwealth, any token holder can drive their community. Subscribe to chain activity like whale transfers or new votes, discuss new ideas, crowdfund community projects, and access native governance for Layer 1s and NFTs alike. '
          ),
        ]),
        m(
          'div',
          {
            class: 'absolute bottom-0 left-0 right-0 transform translate-y-1/2',
          },
          m(
            'div',
            { class: 'glide' },
            m(
              'div',
              { class: 'glide__track', 'data-glide-el': 'track' },
              m('ul', { class: 'glide__slides' }, [
                vnode.attrs.chains.map(
                  (chain: any) => {
                    return m(
                      'li',
                      {
                        class: 'glide__slide  h-56',
                        onclick: (e) => {
                          e.preventDefault();
                          localStorage['home-scrollY'] = window.scrollY;
                          m.route.set(`/${chain.id}`);
                        },
                      },
                      m(
                        'div',
                        {
                          class:
                            'bg-white rounded shadow-xl p-5 xl:p-10 text-center h-56',
                        },
                        [
                          m('img', {
                            class: 'mx-auto mb-3 w-12 h-auto h-56',
                            src: chain.img,
                            alt: '',
                          }),
                          m(
                            'h3',
                            { class: 'text-2xl font-extrabold mb-1' },
                            chain.name
                          ),
                          m('p', { class: 'text-xl' }, chain.chainInfo.description),
                        ]
                      )
                    );
                  }
                ),
              ])
            )
          )
        ),
      ]
    );
  },
};

export default TokensChainsComponent;